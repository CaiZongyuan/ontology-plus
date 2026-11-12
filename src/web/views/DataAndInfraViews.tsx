import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Cpu,
  Database,
  Download,
  Edit3,
  FileText,
  Play,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import type {
  MetricInsightResult,
  ScenarioAttributionResult,
} from '../../packages/agent-runtime/index.js';
import type {
  AnalyticsQueryResult,
  AnalyticsReport,
  AnalyticsScenario,
  DataDocument,
  DataMappingRule,
  DatabaseResource,
  LlmProviderConfig,
  MetricDefinition,
  WritebackInterface,
} from '../../packages/workspace-store/index.js';
import {
  apiDeleteResource,
  apiExecuteAnalyticsSql,
  apiGenerateMetricInsight,
  apiPostJson,
  apiPutJson,
  apiRunScenarioAttribution,
  apiTestLlmProvider,
  triggerBrowserDownload,
  useWorkbenchStore,
} from '../api.js';
import { AgentSessionWorkbench } from '../components/agent/AgentSessionWorkbench.js';
import {
  Button,
  ConfirmDialog,
  RegistryTable,
  type RegistryColumn,
} from '../components/beautifui/index.js';
import { MarkdownRenderer, TiptapMarkdownEditor } from '../components/markdown/index.js';
import {
  usePreferences,
  type NavViewId,
  type ThemePreference,
} from '../i18n.js';
import { KnowledgeGraphCanvas } from './KnowledgeGraphCanvas.js';

// ─── 6. Data Analytics Center: Data Resources, SQL Sandbox & Tiptap Docs ─────

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
  const [sqlText, setSqlText] = useState(SQL_SANDBOX_PRESETS[0]!.sql);
  const [sqlResult, setSqlResult] = useState<AnalyticsQueryResult | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [runningSql, setRunningSql] = useState(false);
  const [extractingDataOntology, setExtractingDataOntology] = useState(false);

  // Data Document Tiptap Editor & Modal state
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [docDraft, setDocDraft] = useState<string>('');
  const [savingDoc, setSavingDoc] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState<DataDocument['category']>('WAREHOUSE_SPEC');
  const [docContent, setDocContent] = useState(
    '## 数仓模型与口径说明\n\n- **分层归属**：`DWD` 明细事实层\n- **主键约束**：`contract_no` 唯一非空\n',
  );
  const [deleteDbTarget, setDeleteDbTarget] = useState<DatabaseResource | null>(null);
  const [deleteDocTarget, setDeleteDocTarget] = useState<DataDocument | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiExecuteAnalyticsSql(SQL_SANDBOX_PRESETS[0]!.sql)
      .then((res) => {
        if (!cancelled) setSqlResult(res);
      })
      .catch(() => {
        // Ignore initial preview error if store is bootstrapping
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (data && !selectedDocId && data.dataDocuments[0]) {
      setSelectedDocId(data.dataDocuments[0].id);
      setDocDraft(data.dataDocuments[0].content);
    }
  }, [data, selectedDocId]);

  const activeDoc = useMemo(() => {
    if (!data) return undefined;
    return data.dataDocuments.find((d) => d.id === selectedDocId) ?? data.dataDocuments[0];
  }, [data, selectedDocId]);

  useEffect(() => {
    if (activeDoc) setDocDraft(activeDoc.content);
  }, [activeDoc?.id]);

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

      const json = await apiPostJson<{
        job: { summary: string };
        project?: typeof data.activeProject;
        blockedBy?: unknown[];
        extractionJobs: typeof data.extractionJobs;
      }>('/api/capability/extraction-jobs', {
        systemId: data.legacySystems[0]?.id ?? 'sys-erp-contract',
        projectId: data.activeProject.id,
        title: t('从数仓资源萃取数据本体 (M1+MM)', 'Extract Data Ontology from Data Resources (M1+MM)'),
        sourceType: 'DDL_AND_OPENAPI',
        sourceSnippet:
          ddlFromTables ||
          'CREATE TABLE t_contract (id VARCHAR(36) PRIMARY KEY, total_amount DECIMAL(18,2));',
        applyImmediately: true,
      });
      if (json.project) {
        patchData({ activeProject: json.project, extractionJobs: json.extractionJobs });
      } else {
        patchData({ extractionJobs: json.extractionJobs });
      }
      if (json.blockedBy?.length) {
        showToast(
          t(
            `数据本体萃取已完成，但合并被一致性门禁阻止（${json.blockedBy.length} 个新增一致性错误）。请到「能力中心 → 本体萃取」逐项确认。`,
            `Data ontology extraction finished, but the merge was blocked by ${json.blockedBy.length} new Consistency Errors. Confirm the candidates under Capability Center → Ontology Extraction.`,
          ),
        );
        return;
      }
      showToast(
        t(
          `已从数据资源完成数据本体萃取 (M1+MM)：${json.job.summary}`,
          `Extracted data ontology (M1+MM) from data resources: ${json.job.summary}`,
        ),
      );
      onNavigate?.('data-mappings');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setExtractingDataOntology(false);
    }
  };

  const handleSaveActiveDoc = async (md: string) => {
    if (!activeDoc) return;
    setSavingDoc(true);
    try {
      const json = await apiPostJson<{ dataDocuments: DataDocument[] }>(
        '/api/analytics/documents',
        {
          id: activeDoc.id,
          title: activeDoc.title,
          category: activeDoc.category,
          content: md,
        },
      );
      patchData({ dataDocuments: json.dataDocuments });
      showToast(t(`已保存数据规范文档「${activeDoc.title}」`, `Saved "${activeDoc.title}"`));
    } finally {
      setSavingDoc(false);
    }
  };

  const handleCreateDataDoc = async () => {
    if (!docTitle.trim() || !docContent.trim()) return;
    const id = `ddoc-${Date.now().toString(36)}`;
    const json = await apiPostJson<{ dataDocuments: DataDocument[] }>(
      '/api/analytics/documents',
      {
        id,
        title: docTitle.trim(),
        category: docCategory,
        content: docContent.trim(),
      },
    );
    patchData({ dataDocuments: json.dataDocuments });
    setSelectedDocId(id);
    setDocDraft(docContent.trim());
    setDocModalOpen(false);
    setDocTitle('');
    showToast(t(`已保存数据规范文档「${docTitle}」`, `Saved data document "${docTitle}"`));
  };

  const handleDeleteDb = async () => {
    if (!deleteDbTarget) return;
    const json = await apiDeleteResource<{ databaseResources: DatabaseResource[] }>(
      `/api/analytics/databases/${deleteDbTarget.id}`,
    );
    patchData({ databaseResources: json.databaseResources });
    setDeleteDbTarget(null);
    showToast(t(`已移除数据源「${deleteDbTarget.name}」`, 'Deleted database resource'));
  };

  const handleDeleteDoc = async () => {
    if (!deleteDocTarget) return;
    const json = await apiDeleteResource<{ dataDocuments: DataDocument[] }>(
      `/api/analytics/documents/${deleteDocTarget.id}`,
    );
    patchData({ dataDocuments: json.dataDocuments });
    if (selectedDocId === deleteDocTarget.id) {
      setSelectedDocId(json.dataDocuments[0]?.id ?? '');
    }
    setDeleteDocTarget(null);
    showToast(t(`已删除数据文档「${deleteDocTarget.title}」`, 'Deleted data document'));
  };

  return (
    <div className="flex flex-col gap-3.5">
      {/* Database Resources & Schema Explorer */}
      {data.databaseResources.map((db) => (
        <div key={db.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{db.name}</h3>
              <div className="font-mono text-[12.5px] text-muted-foreground">
                {db.dialect} · {db.connectionUri}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge badge-ok">{db.status}</span>
              <Button
                type="button"
                variant="accent" size="md"
                disabled={extractingDataOntology}
                onClick={() => void handleExtractDataOntology()}
              >
                {extractingDataOntology
                  ? t('正在萃取...', 'Extracting...')
                  : t('从数据资源萃取数据本体 (M1+MM)', 'Extract Data Ontology (M1+MM)')}
              </Button>
              {data.databaseResources.length > 1 && (
                <Button variant="ghost" size="xs" onClick={() => setDeleteDbTarget(db)}>
                  <Trash2 size={12} className="text-red" />
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {db.tables.map((tb) => (
              <div
                key={tb.tableName} className="p-2.5 bg-inset rounded-[5px] border border-line"
              >
                <div className="flex justify-between items-center">
                  <strong className="font-mono">{tb.tableName}</strong>
                  <div className="flex items-center gap-1">
                    <span className="badge badge-accent">{tb.rowCount} rows</span>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() =>
                        void handleRunSqlPreview(`SELECT * FROM ${tb.tableName} LIMIT 10`)
                      }
                    >
                      SQL
                    </Button>
                  </div>
                </div>
                <div className="text-[11.5px] text-muted-foreground m-[4px_0_8px_0]">
                  {tb.comment}
                </div>
                {tb.columns.map((c) => (
                  <div
                    key={c.name} className="flex justify-between text-[11.5px] font-mono p-[2px_0]"
                  >
                    <span>{c.name}</span>
                    <span className="text-muted-foreground">{c.type}</span>
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
            <div className="text-[12.5px] text-muted-foreground">
              {t(
                '仅允许执行只读 SELECT / WITH 分析查询，自动挂载 __dict 数据字典生成 <col>__label 中文语义列',
                'Executes read-only SELECT / WITH queries against live SQLite tables with automatic <col>__label dictionary enrichment',
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="accent" size="md"
            data-testid="run-sql-preview-btn"
            disabled={runningSql}
            onClick={() => void handleRunSqlPreview()}
          >
            <Database size={13} />
            {runningSql
              ? t('查询中...', 'Running...')
              : t('执行只读 SQL 预览', 'Run SQL Preview')}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-2">
          {SQL_SANDBOX_PRESETS.map((preset) => (
            <Button
              key={preset.labelEn}
              type="button"
              variant="secondary" size="sm"
              onClick={() => void handleRunSqlPreview(preset.sql)}
            >
              {t(preset.labelZh, preset.labelEn)}
            </Button>
          ))}
        </div>

        <textarea
          className="textarea mono"
          rows={3}
          value={sqlText}
          onChange={(e) => setSqlText(e.target.value)}
        />

        {sqlError && (
          <div className="mt-2 p-[8px_10px] rounded-[5px] bg-red-tint text-red font-mono text-[12.5px]"
          >
            {sqlError}
          </div>
        )}

        {sqlResult && (
          <div className="mt-2.5">
            <div className="flex justify-between text-[11.5px] text-muted-foreground font-mono mb-1.5"
            >
              <span>
                Rows: {sqlResult.rowCount} · Elapsed: {sqlResult.elapsedMs}ms
              </span>
              <span>
                Dict Enriched Columns:{' '}
                {sqlResult.columns.filter((c) => c.endsWith('__label')).length}
              </span>
            </div>
            <div
              className="responsive-table-region rounded border border-line"
              role="region"
              aria-label="SQL Sandbox Preview Results"
              tabIndex={0}
            >
              <table className="data-table" data-testid="sql-preview-table">
                <thead>
                  <tr>
                    {sqlResult.columns.map((col) => (
                      <th key={col} style={{ fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                        {col}
                        {col.endsWith('__label') && (
                          <span className="badge badge-accent ml-1">
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
            </div>
          </div>
        )}
      </div>

      {/* Data Documents Section with Tiptap Bidirectional Markdown Editor */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            {t(
              '数仓分层规范与指标口径文档 (双向 Markdown 编辑)',
              'Data Warehouse & Metric Specifications (Tiptap Markdown)',
            )}
          </h3>
          <Button variant="accent" size="xs" onClick={() => setDocModalOpen(true)}>
            <Plus size={12} />
            {t('新建数据文档', 'Add Data Document')}
          </Button>
        </div>

        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-3">
          <div className="flex flex-col gap-1.5">
            {data.dataDocuments.map((doc) => {
              const active = doc.id === activeDoc?.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <strong className="text-[12.5px]">{doc.title}</strong>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteDocTarget(doc);
                      }}
                    >
                      <Trash2 size={11} className="text-red" />
                    </Button>
                  </div>
                  <div className="mt-1">
                    <span className="badge badge-accent">{doc.category}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {activeDoc ? (
            <TiptapMarkdownEditor
              value={docDraft}
              onChange={setDocDraft}
              onSave={handleSaveActiveDoc}
              saving={savingDoc}
              title={activeDoc.title}
              badge={<span className="badge badge-accent">{activeDoc.category}</span>}
              downloadFilename={`${activeDoc.id}.md`}
              minHeight={360}
              testId="data-doc-markdown-editor"
            />
          ) : (
            <div className="p-6 text-ink-3">{t('暂无数据文档', 'No data documents')}</div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={docModalOpen}
        title={t('新建数仓口径与治理规范文档', 'Create Data Specification Document')}
        confirmLabel={t('保存数据文档', 'Save Document')}
        onConfirm={() => void handleCreateDataDoc()}
        onClose={() => setDocModalOpen(false)}
      >
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">{t('文档标题', 'Document Title')} *</label>
            <input
              className="input"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder={t('例如：履约结算事实表 DWD 清洗规范', 'e.g. Settlement Fact Table Spec')}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('文档类别', 'Document Category')}</label>
            <select
              className="select"
              value={docCategory}
              onChange={(e) => setDocCategory(e.target.value as DataDocument['category'])}
            >
              <option value="WAREHOUSE_SPEC">WAREHOUSE_SPEC (数仓模型规范)</option>
              <option value="METRIC_DICT">METRIC_DICT (指标口径字典)</option>
              <option value="GOVERNANCE_RULE">GOVERNANCE_RULE (数据质量门禁)</option>
            </select>
          </div>
        </div>
        <div className="form-field">
          <label className="form-label">{t('Markdown 文档内容', 'Content (Markdown)')} *</label>
          <textarea
            className="textarea mono"
            rows={6}
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteDbTarget)}
        title={t('移除数据源连接', 'Delete Database Resource')}
        description={
          deleteDbTarget
            ? t(`确认移除数据源「${deleteDbTarget.name}」吗？`, `Delete "${deleteDbTarget.name}"?`)
            : ''
        }
        confirmLabel={t('确认移除', 'Delete')}
        danger
        onConfirm={() => void handleDeleteDb()}
        onClose={() => setDeleteDbTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteDocTarget)}
        title={t('删除数据规范文档', 'Delete Data Document')}
        description={
          deleteDocTarget
            ? t(`确认删除「${deleteDocTarget.title}」吗？`, `Delete "${deleteDocTarget.title}"?`)
            : ''
        }
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={() => void handleDeleteDoc()}
        onClose={() => setDeleteDocTarget(null)}
      />
    </div>
  );
}

// ─── 7. Data Analytics Center: Data Lineage Graph & MM Column Mappings ───────

export function DataMappingsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DataMappingRule | null>(null);

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

  const handleSaveMapping = async () => {
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
    const json = await apiPostJson<{ dataMappings: DataMappingRule[] }>(
      '/api/analytics/mappings',
      payload,
    );
    patchData({ dataMappings: json.dataMappings });
    setModalOpen(false);
    showToast(
      t(
        `已保存数据本体字段映射规则：${payload.ontologyAttribute} ↔ ${payload.sourceTable}.${payload.sourceColumn}`,
        `Saved mapping rule ${payload.ontologyAttribute}`,
      ),
    );
  };

  const handleDeleteMapping = async () => {
    if (!deleteTarget) return;
    const json = await apiDeleteResource<{ dataMappings: DataMappingRule[] }>(
      `/api/analytics/mappings/${deleteTarget.id}`,
    );
    patchData({ dataMappings: json.dataMappings });
    setDeleteTarget(null);
    showToast(t('已删除字段映射规则', 'Deleted mapping rule'));
  };

  const columns: RegistryColumn<DataMappingRule>[] = [
    {
      key: 'object',
      header: t('本体对象', 'Ontology Object'),
      render: (m) => <span className="badge badge-accent">{m.ontologyObject}</span>,
    },
    {
      key: 'attr',
      header: t('本体属性', 'Ontology Attribute'),
      render: (m) => <span className="font-mono font-semibold text-ink">{m.ontologyAttribute}</span>,
    },
    {
      key: 'physical',
      header: t('物理表.字段', 'Source Table.Column'),
      render: (m) => (
        <span className="font-mono text-[12.5px]">
          {m.sourceTable}.{m.sourceColumn}
        </span>
      ),
    },
    {
      key: 'transform',
      header: t('清洗转换表达式', 'Transform Expression'),
      render: (m) => <span className="font-mono text-[11.5px] text-ink-2">{m.transformExpr}</span>,
    },
    {
      key: 'quality',
      header: t('数据质量门禁规则', 'Data Quality Rule'),
      render: (m) => <span className="font-mono text-[11.5px] text-ink-3">{m.qualityRule}</span>,
    },
    {
      key: 'actions',
      header: t('操作', 'Actions'),
      align: 'right',
      render: (m) => (
        <div className="inline-flex items-center gap-1.5">
          <Button variant="secondary" size="xs" onClick={() => openEditMapping(m)}>
            <Edit3 size={11.5} />
            {t('编辑', 'Edit')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setDeleteTarget(m)}>
            <Trash2 size={11.5} className="text-red" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t(
                '数据本体语义血缘图谱 (M1 业务对象 ↔ MM 物理库表映射 ↔ M7 分析视图)',
                'Data Ontology Semantic Lineage Graph (M1 ↔ MM ↔ M7)',
              )}
            </h3>
            <div className="text-[12.5px] text-muted-foreground">
              {t(
                '基于 React Flow + ELK 正交分层透视 M1 聚合根、MM 物理数仓表与 M7 查询报表模型血缘',
                'Interactive React Flow + ELK semantic lineage across M1 aggregates, MM tables, and M7 reports',
              )}
            </div>
          </div>
          <div className="flex gap-1.5">
            <span className="badge badge-accent">M1 Objects: {m1Count}</span>
            <span className="badge badge-ok">MM Mappings: {mmCount}</span>
            <span className="badge badge-warn">M7 Reports: {m7Count}</span>
          </div>
        </div>
        <KnowledgeGraphCanvas
          graph={data.activeProject.knowledgeGraph}
          preset="DATA_LINEAGE"
          height={420}
        />
      </div>

      <RegistryTable
        title={t(
          '数据本体与数仓物理表字段映射规则 (MM Column Mapping Rules)',
          'Data Ontology to Physical Column Mappings',
        )}
        rows={data.dataMappings}
        getRowKey={(m) => m.id}
        columns={columns}
        matchesSearch={(m, q) =>
          m.ontologyObject.toLowerCase().includes(q) ||
          m.ontologyAttribute.toLowerCase().includes(q) ||
          m.sourceTable.toLowerCase().includes(q) ||
          m.sourceColumn.toLowerCase().includes(q)
        }
        primaryActionLabel={t('新增字段映射规则', 'New Column Mapping')}
        onPrimaryAction={openCreateMapping}
        testId="data-mappings-registry"
      />

      <ConfirmDialog
        open={modalOpen}
        title={
          editingRuleId
            ? t('编辑 MM 字段映射规则', 'Edit MM Column Mapping')
            : t('新增 MM 字段映射与质量门禁规则', 'Add MM Column Mapping Rule')
        }
        confirmLabel={t('保存映射规则', 'Save Mapping')}
        onConfirm={() => void handleSaveMapping()}
        onClose={() => setModalOpen(false)}
      >
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">{t('本体对象 (M1 Aggregate)', 'Ontology Object')}</label>
            <input
              className="input"
              value={ontologyObject}
              onChange={(e) => setOntologyObject(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('本体属性路径', 'Ontology Attribute')}</label>
            <input
              className="input"
              value={ontologyAttribute}
              onChange={(e) => setOntologyAttribute(e.target.value)}
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
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('源物理字段名', 'Source Column')}</label>
            <input
              className="input"
              value={sourceColumn}
              onChange={(e) => setSourceColumn(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('SQL 清洗转换表达式', 'Transform Expression')}</label>
            <input
              className="input"
              value={transformExpr}
              onChange={(e) => setTransformExpr(e.target.value)}
            />
          </div>
        </div>
        <div className="form-field">
          <label className="form-label">{t('数据质量校验门禁规则', 'Data Quality Gate Rule')}</label>
          <input
            className="input"
            value={qualityRule}
            onChange={(e) => setQualityRule(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('删除字段映射规则', 'Delete Column Mapping')}
        description={
          deleteTarget
            ? `${deleteTarget.ontologyAttribute} ↔ ${deleteTarget.sourceTable}.${deleteTarget.sourceColumn}`
            : ''
        }
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={() => void handleDeleteMapping()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── 8. Data Analytics Center: Metrics, Scenario Attribution & Tiptap Reports ─

export function DataMetricsReportsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [viewMode, setViewMode] = useState<'DASHBOARD' | 'REPORTS_EDITOR'>('DASHBOARD');
  const [insightsByMetric, setInsightsByMetric] = useState<Record<string, MetricInsightResult>>({});
  const [loadingMetricId, setLoadingMetricId] = useState<string | null>(null);
  const [attributionsByScenario, setAttributionsByScenario] = useState<
    Record<string, ScenarioAttributionResult>
  >({});
  const [loadingScenarioId, setLoadingScenarioId] = useState<string | null>(null);

  // Report Tiptap Editor state
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [reportDraft, setReportDraft] = useState<string>('');
  const [savingReport, setSavingReport] = useState(false);

  // Modals & Delete guards
  const [metricModalOpen, setMetricModalOpen] = useState(false);
  const [mCode, setMCode] = useState('MFT_ARCHIVE_TIMELINESS');
  const [mName, setMName] = useState('签章合同跨网归档及时率');
  const [mCategory, setMCategory] = useState('安全合规效能');
  const [mFormula, setMFormula] = useState('COUNT(ArchivedWithin2h) / COUNT(ApprovedContracts)');
  const [mCurrentValue, setMCurrentValue] = useState('96.2%');
  const [mYoY, setMYoY] = useState('+2.4%');
  const [mStatus, setMStatus] = useState<'NORMAL' | 'WARNING' | 'CRITICAL'>('NORMAL');
  const [mAggregate, setMAggregate] = useState('Contract');

  const [deleteMetricTarget, setDeleteMetricTarget] = useState<MetricDefinition | null>(null);
  const [deleteScenarioTarget, setDeleteScenarioTarget] = useState<AnalyticsScenario | null>(null);
  const [deleteReportTarget, setDeleteReportTarget] = useState<AnalyticsReport | null>(null);

  useEffect(() => {
    if (data && !selectedReportId && data.analyticsReports[0]) {
      setSelectedReportId(data.analyticsReports[0].id);
      setReportDraft(data.analyticsReports[0].markdownContent);
    }
  }, [data, selectedReportId]);

  const activeReport = useMemo(() => {
    if (!data) return undefined;
    return (
      data.analyticsReports.find((r) => r.id === selectedReportId) ?? data.analyticsReports[0]
    );
  }, [data, selectedReportId]);

  useEffect(() => {
    if (activeReport) setReportDraft(activeReport.markdownContent);
  }, [activeReport?.id]);

  if (!data) return null;

  const handleMetricInsight = async (metricId: string) => {
    setLoadingMetricId(metricId);
    try {
      const res = await apiGenerateMetricInsight(metricId);
      setInsightsByMetric((prev) => ({ ...prev, [metricId]: res }));
      showToast(
        t(`已生成指标 ${res.metric.name} 的 AI 异动洞察`, `Generated AI insight for ${res.metric.code}`),
      );
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
      if (res.savedReport) {
        setSelectedReportId(res.savedReport.id);
        setReportDraft(res.savedReport.markdownContent);
      }
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
    const json = await apiPostJson<{ writebackInterfaces: WritebackInterface[] }>(
      `/api/analytics/writebacks/${interfaceId}/execute`,
      { payloadOverride: { source: 'METRIC_INSIGHT_CLOSED_LOOP' } },
    );
    patchData({ writebackInterfaces: json.writebackInterfaces });
    showToast(`已触发闭环回写接口 ${interfaceId} 执行成功`);
  };

  const handleCreateMetric = async () => {
    if (!mCode.trim() || !mName.trim()) return;
    const json = await apiPostJson<{ metrics: MetricDefinition[] }>('/api/analytics/metrics', {
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
    });
    patchData({ metrics: json.metrics });
    setMetricModalOpen(false);
    showToast(t(`已新增业务分析指标「${mName}」`, `Added metric "${mName}"`));
  };

  const handleSaveReport = async (md: string) => {
    if (!activeReport) return;
    setSavingReport(true);
    try {
      const json = await apiPostJson<{ analyticsReports: AnalyticsReport[] }>(
        '/api/analytics/reports',
        {
          id: activeReport.id,
          title: activeReport.title,
          period: activeReport.period,
          author: activeReport.author,
          summary: activeReport.summary,
          markdownContent: md,
        },
      );
      patchData({ analyticsReports: json.analyticsReports });
      showToast(t(`已保存归档分析报告「${activeReport.title}」`, `Saved "${activeReport.title}"`));
    } finally {
      setSavingReport(false);
    }
  };

  const handleCreateNewReport = async () => {
    const id = `rep-${Date.now().toString(36)}`;
    const md = `# 专题数据本体分析报告\n\n- **统计周期**：2026-Q4\n- **核心发现**：华东区大额采购合同结算周期环比收敛 11%。\n`;
    const json = await apiPostJson<{ analyticsReports: AnalyticsReport[] }>(
      '/api/analytics/reports',
      {
        id,
        title: `新建数据本体专题报告 (${new Date().toISOString().slice(0, 10)})`,
        period: '2026-Q4',
        author: 'Ontology Analytics Center',
        summary: '基于 M1+MM+M7 指标体系撰写的业务分析报告',
        markdownContent: md,
      },
    );
    patchData({ analyticsReports: json.analyticsReports });
    setSelectedReportId(id);
    setReportDraft(md);
    setViewMode('REPORTS_EDITOR');
    showToast(t('已新建空白分析报告并打开双向编辑器', 'Created new analytical report'));
  };

  const reportColumns: RegistryColumn<AnalyticsReport>[] = [
    {
      key: 'title',
      header: t('分析报告标题', 'Report Title'),
      render: (rp) => (
        <div>
          <div className="font-semibold text-ink">{rp.title}</div>
          <div className="text-[11.5px] text-ink-3">{rp.summary}</div>
        </div>
      ),
    },
    {
      key: 'period',
      header: t('周期 / 作者', 'Period / Author'),
      render: (rp) => (
        <span className="font-mono text-[12.5px]">
          {rp.period} · {rp.author}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('操作', 'Actions'),
      align: 'right',
      render: (rp) => (
        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              setSelectedReportId(rp.id);
              setViewMode('REPORTS_EDITOR');
            }}
          >
            <Edit3 size={11.5} />
            {t('编辑', 'Edit')}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() =>
              triggerBrowserDownload(`${rp.id}.md`, rp.markdownContent, 'text/markdown;charset=utf-8')
            }
          >
            <Download size={11.5} />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setDeleteReportTarget(rp)}>
            <Trash2 size={11.5} className="text-red" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Top Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-window border border-line bg-surface px-4 py-2.5 shadow-2xs">
        <div className="inline-flex items-center gap-1 rounded-control bg-inset p-1">
          <Button
            type="button"
            variant="toggle" size="sm" aria-pressed={viewMode === 'DASHBOARD'}
            onClick={() => setViewMode('DASHBOARD')}
          >
            <BarChart3 size={13} />
            {t('指标监控与场景归因工作台', 'Metrics & Attribution Workbench')}
          </Button>
          <Button
            type="button"
            variant="toggle" size="sm" aria-pressed={viewMode === 'REPORTS_EDITOR'}
            onClick={() => setViewMode('REPORTS_EDITOR')}
            data-testid="reports-mode-editor-btn"
          >
            <FileText size={13} />
            {t('分析报告双向编辑与注册表', 'Reports Editor & Registry')} ({data.analyticsReports.length})
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void handleCreateNewReport()}>
            <Plus size={13} />
            {t('新建分析报告', 'New Report')}
          </Button>
          <Button variant="accent" size="sm" onClick={() => setMetricModalOpen(true)}>
            <Plus size={13} />
            {t('新增指标', 'New Metric')}
          </Button>
        </div>
      </div>

      {viewMode === 'REPORTS_EDITOR' ? (
        <div className="flex flex-col gap-3.5">
          <RegistryTable
            title={t('归档分析报告管理注册表', 'Archived Analytical Reports Registry')}
            rows={data.analyticsReports}
            getRowKey={(r) => r.id}
            activeRowKey={activeReport?.id}
            columns={reportColumns}
            matchesSearch={(r, q) =>
              r.title.toLowerCase().includes(q) ||
              r.summary.toLowerCase().includes(q) ||
              r.markdownContent.toLowerCase().includes(q)
            }
            onRowClick={(r) => setSelectedReportId(r.id)}
            testId="analytics-reports-registry"
          />

          {activeReport && (
            <TiptapMarkdownEditor
              value={reportDraft}
              onChange={setReportDraft}
              onSave={handleSaveReport}
              saving={savingReport}
              title={activeReport.title}
              badge={<span className="badge badge-ok">{activeReport.period}</span>}
              downloadFilename={`${activeReport.id}.md`}
              minHeight={440}
              testId="analytics-report-markdown-editor"
            />
          )}
        </div>
      ) : (
        <>
          {/* 1. Metrics Grid */}
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  {t(
                    '指标库与 AI 异动洞察',
                    'Ontology Metrics & AI Anomaly Insights',
                  )}
                </h3>
                <div className="text-[12.5px] text-muted-foreground">
                  {t(
                    '基于 M1 聚合根与 MM 物理表实时聚合指标，支持一键触发 AI 异动根因洞察与业务回写',
                    'Metrics bound to M1 aggregates and MM tables with one-click AI anomaly driver insights',
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {data.metrics.map((m, idx) => {
                const insight = insightsByMetric[m.id];
                return (
                  <div
                    key={m.id} className="p-3 rounded-[6px] bg-inset border border-line flex flex-col gap-1.5"
                  >
                    <div className="flex justify-between items-center">
                      <span className="badge badge-accent">{m.code}</span>
                      <div className="inline-flex items-center gap-1">
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
                        {data.metrics.length > 1 && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setDeleteMetricTarget(m)}
                          >
                            <Trash2 size={11} className="text-red" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="font-semibold text-[14px]">{m.name}</div>
                    <div className="font-serif text-[24px] font-semibold">
                      {m.currentValue}{' '}
                      <span className="text-[12.5px] font-mono text-muted-foreground">
                        ({m.yoYChange})
                      </span>
                    </div>
                    <div className="font-mono text-[11.5px] text-muted-foreground">
                      {m.formula}
                    </div>

                    <div className="mt-1">
                      <Button
                        type="button"
                        variant="accent" size="sm"
                        data-testid={idx === 0 ? 'metric-insight-btn' : `metric-insight-btn-${m.id}`}
                        disabled={loadingMetricId === m.id}
                        onClick={() => void handleMetricInsight(m.id)}
                      >
                        {loadingMetricId === m.id
                          ? t('洞察分析中...', 'Analyzing...')
                          : t('AI 异动洞察', 'AI Metric Insight')}
                      </Button>
                    </div>

                    {insight && (
                      <div className="mt-1.5 p-2.5 rounded-[5px] bg-surface border border-line text-[12.5px] flex flex-col gap-1.5"
                      >
                        <div className="font-semibold text-accent">
                          {t('AI 异动驱动因子：', 'Anomaly Drivers:')}
                        </div>
                        {insight.anomalyDrivers.map((drv, dIdx) => (
                          <div key={dIdx} className="text-[11.5px]">
                            • {drv}
                          </div>
                        ))}
                        <div className="text-[11.5px] text-muted-foreground">
                          {insight.suggestedAction}
                        </div>
                        <div>
                          <Button
                            type="button"
                            variant="secondary" size="sm"
                            onClick={() => void handleQuickWriteback(insight.writebackInterfaceId)}
                          >
                            {t(
                              `触发闭环回写 (${insight.writebackInterfaceId})`,
                              `Trigger Write-Back (${insight.writebackInterfaceId})`,
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Analytics Scenarios */}
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  {t(
                    '场景分析与归因',
                    'Domain Scenario Analysis & Attribution',
                  )}
                </h3>
                <div className="text-[12.5px] text-muted-foreground">
                  {t(
                    '围绕异常预警条件组织多指标联合归因，一键生成并归档结构化分析报告',
                    'Multi-metric causal attribution scenarios that synthesize and archive analytical reports',
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {data.analyticsScenarios.map((sc, idx) => {
                const attrRes = attributionsByScenario[sc.id];
                return (
                  <div
                    key={sc.id} className="p-3 rounded-[6px] bg-inset border border-line flex flex-col gap-2"
                  >
                    <div className="flex justify-between items-start gap-2.5"
                    >
                      <div>
                        <strong className="text-[14px]">{sc.name}</strong>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <span className="badge badge-warn">Trigger: {sc.triggerCondition}</span>
                          {sc.relatedMetrics.map((mid) => (
                            <span key={mid} className="badge badge-accent">
                              {mid}
                            </span>
                          ))}
                          <span className="badge badge-ok">
                            Write-Back: {sc.writebackInterfaceId}
                          </span>
                        </div>
                      </div>
                      <div className="inline-flex items-center gap-2">
                        <Button
                          type="button"
                          variant="accent" size="md"
                          data-testid={
                            idx === 0 ? 'scenario-attribute-btn' : `scenario-attribute-btn-${sc.id}`
                          }
                          disabled={loadingScenarioId === sc.id}
                          onClick={() => void handleScenarioAttribution(sc.id)}
                        >
                          {loadingScenarioId === sc.id
                            ? t('归因生成中...', 'Attributing...')
                            : t('AI 归因分析并生成报告', 'AI Attribution & Save Report')}
                        </Button>
                        {data.analyticsScenarios.length > 1 && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setDeleteScenarioTarget(sc)}
                          >
                            <Trash2 size={12} className="text-red" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="form-grid-2">
                      <div>
                        <div className="text-[11.5px] font-semibold text-muted-foreground mb-1"
                        >
                          {t('预设本体归因链因子', 'Ontology Causal Factors')}
                        </div>
                        {sc.causalFactors.map((cf, i) => (
                          <div key={i} className="text-[12.5px] mb-0.75">
                            • {cf}
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="text-[11.5px] font-semibold text-muted-foreground mb-1"
                        >
                          {t('建议闭环处置策略', 'Recommended Actions')}
                        </div>
                        {sc.recommendedActions.map((act, i) => (
                          <div key={i} className="text-[12.5px] mb-0.75">
                            • {act}
                          </div>
                        ))}
                      </div>
                    </div>

                    {attrRes && (
                      <div className="p-2.5 rounded-[5px] bg-surface border border-line"
                      >
                        <div className="flex justify-between mb-1.5">
                          <strong className="text-[12.5px]">
                            {t('实时归因贡献度拆解', 'Live Causal Contribution Breakdown')}
                          </strong>
                          {attrRes.savedReport && (
                            <span className="badge badge-ok">
                              {t('已归档至分析报告库', 'Archived to Reports')}: {attrRes.savedReport.id}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          {attrRes.causalBreakdown.map((item, cIdx) => (
                            <div
                              key={cIdx} className="flex justify-between gap-2 text-[12.5px] p-[4px_6px] bg-inset rounded-[4px]"
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

          {/* 3. Rendered Archived Analytical Reports Preview */}
          <div className="flex flex-col gap-3">
            {data.analyticsReports.map((rp) => (
              <div key={rp.id} className="card">
                <div className="card-header">
                  <div>
                    <h3 className="card-title">{rp.title}</h3>
                    <div className="text-[12.5px] text-muted-foreground">
                      {rp.period} · {rp.author}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="badge badge-ok">{t('已归档报告', 'Published Report')}</span>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => {
                        setSelectedReportId(rp.id);
                        setViewMode('REPORTS_EDITOR');
                      }}
                    >
                      <Edit3 size={11.5} />
                      {t('Tiptap 编辑', 'Edit in Tiptap')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() =>
                        triggerBrowserDownload(
                          `${rp.id}.md`,
                          rp.markdownContent,
                          'text/markdown;charset=utf-8',
                        )
                      }
                    >
                      <Download size={11.5} />
                      {t('导出 Markdown', 'Export .md')}
                    </Button>
                  </div>
                </div>
                <div className="rounded-card border border-line bg-surface-2 p-3.5">
                  <MarkdownRenderer content={rp.markdownContent} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={metricModalOpen}
        title={t('新增数据本体分析指标', 'Create Ontology Metric')}
        confirmLabel={t('保存指标定义', 'Save Metric')}
        onConfirm={() => void handleCreateMetric()}
        onClose={() => setMetricModalOpen(false)}
      >
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">{t('指标编码', 'Metric Code')} *</label>
            <input className="input" value={mCode} onChange={(e) => setMCode(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">{t('指标名称', 'Metric Name')} *</label>
            <input className="input" value={mName} onChange={(e) => setMName(e.target.value)} />
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
            <input className="input" value={mYoY} onChange={(e) => setMYoY(e.target.value)} />
          </div>
        </div>
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">{t('本体计算公式', 'Ontology Formula')}</label>
            <input
              className="input"
              value={mFormula}
              onChange={(e) => setMFormula(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('监控健康状态', 'Health Status')}</label>
            <select
              className="select"
              value={mStatus}
              onChange={(e) => setMStatus(e.target.value as 'NORMAL' | 'WARNING' | 'CRITICAL')}
            >
              <option value="NORMAL">NORMAL</option>
              <option value="WARNING">WARNING</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteMetricTarget)}
        title={t('删除分析指标', 'Delete Metric')}
        description={deleteMetricTarget?.name ?? ''}
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={async () => {
          if (!deleteMetricTarget) return;
          const json = await apiDeleteResource<{ metrics: MetricDefinition[] }>(
            `/api/analytics/metrics/${deleteMetricTarget.id}`,
          );
          patchData({ metrics: json.metrics });
          setDeleteMetricTarget(null);
          showToast(t('已删除分析指标', 'Deleted metric'));
        }}
        onClose={() => setDeleteMetricTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteScenarioTarget)}
        title={t('删除专题归因场景', 'Delete Scenario')}
        description={deleteScenarioTarget?.name ?? ''}
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={async () => {
          if (!deleteScenarioTarget) return;
          const json = await apiDeleteResource<{ analyticsScenarios: AnalyticsScenario[] }>(
            `/api/analytics/scenarios/${deleteScenarioTarget.id}`,
          );
          patchData({ analyticsScenarios: json.analyticsScenarios });
          setDeleteScenarioTarget(null);
          showToast(t('已删除归因场景', 'Deleted scenario'));
        }}
        onClose={() => setDeleteScenarioTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteReportTarget)}
        title={t('删除归档分析报告', 'Delete Report')}
        description={deleteReportTarget?.title ?? ''}
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={async () => {
          if (!deleteReportTarget) return;
          const json = await apiDeleteResource<{ analyticsReports: AnalyticsReport[] }>(
            `/api/analytics/reports/${deleteReportTarget.id}`,
          );
          patchData({ analyticsReports: json.analyticsReports });
          if (selectedReportId === deleteReportTarget.id) {
            setSelectedReportId(json.analyticsReports[0]?.id ?? '');
          }
          setDeleteReportTarget(null);
          showToast(t('已删除分析报告', 'Deleted report'));
        }}
        onClose={() => setDeleteReportTarget(null)}
      />
    </div>
  );
}

// ─── 9. Data Ontology Reasoning (三阶流式推理工作台 & 闭环回写) ───────────────

export function DataReasoningView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();

  if (!data) return null;

  const seededSession = data.reasoningSessions[0];

  const handleTriggerWriteback = async (interfaceId: string, actionTitle?: string) => {
    const json = await apiPostJson<{ writebackInterfaces: WritebackInterface[] }>(
      `/api/analytics/writebacks/${interfaceId}/execute`,
      {
        payloadOverride: {
          triggeredBy: 'REASONING_AGENT_WORKBENCH',
          ...(actionTitle ? { actionTitle } : {}),
        },
      },
    );
    patchData({ writebackInterfaces: json.writebackInterfaces });
    showToast(`已通过回写接口 ${interfaceId} 将决策指令回写至业务系统`);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <AgentSessionWorkbench
        agentKind="REASONING"
        defaultReasoningMode="ASK_POLICY"
        defaultPromptWhenEmpty="为什么本季度高风险合同逾期未结算率上升到了 14.8%？应该采取什么策略并回写业务系统？"
        title={t(
          '数据本体三阶流式推理引擎 (智能问数 ASK_DATA → 智能问因 ASK_WHY → 智能问策 ASK_POLICY)',
          'Data Ontology 3-Stage Streaming Reasoning Engine',
        )}
        subtitle={t(
          '自动穿透 M1 对象关联链、MM 物理表实时只读 SQL 查询与 M3 规则阈值，支持多会话分叉与闭环策略写回',
          'Live SQL + M1/MM/M3 causal reasoning with multi-session history and closed-loop write-back',
        )}
        inputTestId="reasoning-question-input"
        sendBtnTestId="run-reasoning-btn"
        onTriggerWriteback={(wbId, recTitle) => void handleTriggerWriteback(wbId, recTitle)}
      />

      {/* Governed Policy Write-Back Quick Cards */}
      {seededSession && seededSession.policyRecommendations.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ marginBottom: 8 }}>
            <div>
              <h4 className="card-title">
                {t('智能问策：受治理业务闭环回写动作库', 'Governed Policy Write-Back Actions')}
              </h4>
              <div className="text-[12.5px] text-muted-foreground">
                {t(
                  '将三阶数据本体推理产出的风控策略通过 MI / Writeback 接口一键回写存量业务系统',
                  'Execute policy recommendations via governed MI Write-Back interfaces',
                )}
              </div>
            </div>
            <span className="badge badge-accent">{seededSession.mode}</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {seededSession.policyRecommendations.map((rec, i) => (
              <div
                key={i} className="p-3 bg-inset rounded-[6px] border border-line flex flex-col justify-between gap-2"
              >
                <div>
                  <div className="flex justify-between gap-1.5">
                    <strong>{rec.actionTitle}</strong>
                    <span className="badge badge-accent">{rec.targetObject}</span>
                  </div>
                  <div className="text-[12.5px] text-muted-foreground mt-1">
                    {rec.expectedImpact}
                  </div>
                </div>
                <div>
                  <Button
                    type="button"
                    variant="accent" size="sm"
                    data-testid={
                      i === 0
                        ? 'trigger-policy-writeback-btn'
                        : `trigger-policy-writeback-btn-${i}`
                    }
                    onClick={() => void handleTriggerWriteback(rec.writebackInterfaceId, rec.actionTitle)}
                  >
                    <Send size={11.5} />
                    {t(
                      `立即调用回写接口 (${rec.writebackInterfaceId}) 执行闭环`,
                      `Execute Write-Back (${rec.writebackInterfaceId})`,
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 10. Data Write-Back Hub (数据回写中心 CRUD + 在线联调) ───────────────────

export function DataWritebackView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [payloadDrafts, setPayloadDrafts] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string | null>>({});

  const [createOpen, setCreateOpen] = useState(false);
  const [wbName, setWbName] = useState('高风险供应商准入评级自动降级回写接口');
  const [wbTargetSys, setWbTargetSys] = useState('SRM 供应商协同系统');
  const [wbEndpoint, setWbEndpoint] = useState('POST /api/v1/suppliers/downgrade-credit');
  const [wbBehaviorRef, setWbBehaviorRef] = useState('BHV-03');
  const [deleteTarget, setDeleteTarget] = useState<WritebackInterface | null>(null);

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

    const json = await apiPostJson<{ writebackInterfaces: WritebackInterface[] }>(
      `/api/analytics/writebacks/${id}/execute`,
      { payloadOverride: parsedOverride },
    );
    patchData({ writebackInterfaces: json.writebackInterfaces });
    showToast(`回写接口 ${id} 执行成功`);
  };

  const handleCreateWriteback = async () => {
    if (!wbName.trim()) return;
    const id = `WB-0${data.writebackInterfaces.length + 1}`;
    const nextWb: WritebackInterface = {
      id,
      name: wbName.trim(),
      targetSystem: wbTargetSys.trim(),
      protocol: 'REST_POST',
      endpoint: wbEndpoint.trim(),
      boundBehaviorRef: wbBehaviorRef.trim(),
      payloadTemplate: {
        action: 'DOWNGRADE_CREDIT_GRADE',
        reason: 'Triggered by Ontology 3-Stage Policy Reasoning',
      },
      executionCount: 0,
    };
    const json = await apiPostJson<{ writebackInterfaces: WritebackInterface[] }>(
      '/api/analytics/writebacks',
      nextWb,
    );
    patchData({ writebackInterfaces: json.writebackInterfaces });
    setCreateOpen(false);
    showToast(t(`已注册业务回写接口 ${id}`, `Registered writeback interface ${id}`));
  };

  const handleDeleteWriteback = async () => {
    if (!deleteTarget) return;
    const json = await apiDeleteResource<{ writebackInterfaces: WritebackInterface[] }>(
      `/api/analytics/writebacks/${deleteTarget.id}`,
    );
    patchData({ writebackInterfaces: json.writebackInterfaces });
    setDeleteTarget(null);
    showToast(t(`已移除回写接口 ${deleteTarget.id}`, 'Deleted writeback interface'));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-window border border-line bg-surface px-4 py-2.5 shadow-2xs">
        <div className="text-[13px] font-semibold text-ink">
          {t('受治理业务系统闭环回写接口注册表', 'Governed Write-Back Interfaces')} (
          {data.writebackInterfaces.length})
        </div>
        <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={13} />
          {t('注册回写接口', 'Register Write-Back')}
        </Button>
      </div>

      {data.writebackInterfaces.map((wb) => (
        <div key={wb.id} className="card flex flex-col gap-2.5">
          <div className="card-header" style={{ marginBottom: 0 }}>
            <div>
              <h3 className="card-title">
                {wb.id} · {wb.name}
              </h3>
              <div className="text-[12.5px] text-muted-foreground font-mono">
                Protocol: {wb.protocol} · Target: {wb.targetSystem} ({wb.endpoint}) · Bound M2
                Behavior: {wb.boundBehaviorRef}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge badge-ok">
                {t('累计回写次数', 'Executions')}: {wb.executionCount}
              </span>
              <Button
                type="button"
                variant="accent" size="md"
                onClick={() => void handleExecute(wb.id, wb.payloadTemplate)}
              >
                <Play size={12.5} />
                {t('立即执行业务回写', 'Execute Write-Back')}
              </Button>
              {data.writebackInterfaces.length > 1 && (
                <Button variant="ghost" size="xs" onClick={() => setDeleteTarget(wb)}>
                  <Trash2 size={12} className="text-red" />
                </Button>
              )}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">
              {t('可编辑回写指令 JSON 载荷', 'Editable Write-Back JSON Payload')}
            </label>
            <textarea
              className="textarea mono"
              rows={5}
              value={getDraftValue(wb.id, wb.payloadTemplate)}
              onChange={(e) => setPayloadDrafts((prev) => ({ ...prev, [wb.id]: e.target.value }))}
            />
            {jsonErrors[wb.id] && (
              <div className="text-[11.5px] text-red font-mono">
                {jsonErrors[wb.id]}
              </div>
            )}
          </div>

          {wb.lastExecutionResult && (
            <div className="p-2.5 bg-green-tint text-green rounded-[5px] font-mono text-[12.5px]"
            >
              {wb.lastExecutionResult}
            </div>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={createOpen}
        title={t('注册业务系统闭环回写接口', 'Register Write-Back Interface')}
        confirmLabel={t('保存接口', 'Save')}
        onConfirm={() => void handleCreateWriteback()}
        onClose={() => setCreateOpen(false)}
      >
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">{t('接口名称', 'Interface Name')} *</label>
            <input className="input" value={wbName} onChange={(e) => setWbName(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">{t('目标业务系统', 'Target System')}</label>
            <input
              className="input"
              value={wbTargetSys}
              onChange={(e) => setWbTargetSys(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('Webhook / REST 端点', 'Endpoint')}</label>
            <input
              className="input"
              value={wbEndpoint}
              onChange={(e) => setWbEndpoint(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('绑定 M2 领域行为 ID', 'Bound M2 Behavior')}</label>
            <input
              className="input"
              value={wbBehaviorRef}
              onChange={(e) => setWbBehaviorRef(e.target.value)}
            />
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('移除回写接口', 'Delete Write-Back Interface')}
        description={deleteTarget ? `${deleteTarget.id} · ${deleteTarget.name}` : ''}
        confirmLabel={t('确认移除', 'Delete')}
        danger
        onConfirm={() => void handleDeleteWriteback()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── 11. LLM Center & System Settings (大模型中心 & 系统设置) ─────────────────

export function LlmCenterView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LlmProviderConfig | null>(null);

  const [name, setName] = useState('Enterprise OpenAI-Compatible Gateway');
  const [providerType, setProviderType] =
    useState<LlmProviderConfig['providerType']>('OPENAI_COMPATIBLE');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:3425/v1');
  const [apiKey, setApiKey] = useState('magpie');
  const [defaultModel, setDefaultModel] = useState('auto/glm-5.3-flash');
  const [modelsCsv, setModelsCsv] = useState('auto/glm-5.3-flash, auto/glm-5.2');
  const [enabled, setEnabled] = useState(true);

  if (!data) return null;

  const handlePing = async (providerId: string) => {
    setTestingId(providerId);
    try {
      const res = await apiTestLlmProvider(providerId);
      patchData({ llmProviders: res.llmProviders });
      showToast(
        res.ping.ok
          ? `连接成功 (${res.ping.latencyMs}ms): ${res.ping.sampleReply}`
          : `连接探测返回: ${res.ping.errorMessage}`,
      );
    } finally {
      setTestingId(null);
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    setName('Google Gemini / OpenAI Gateway');
    setProviderType('OPENAI_COMPATIBLE');
    setBaseUrl('http://127.0.0.1:3425/v1');
    setApiKey('magpie');
    setDefaultModel('auto/glm-5.3-flash');
    setModelsCsv('auto/glm-5.3-flash, gemini-2.5-flash');
    setEnabled(true);
    setModalOpen(true);
  };

  const openEditModal = (p: LlmProviderConfig) => {
    setEditingId(p.id);
    setName(p.name);
    setProviderType(p.providerType);
    setBaseUrl(p.baseUrl);
    setApiKey(p.apiKey);
    setDefaultModel(p.defaultModel);
    setModelsCsv(p.availableModels.join(', '));
    setEnabled(p.enabled);
    setModalOpen(true);
  };

  const handleSaveProvider = async () => {
    if (!name.trim() || !baseUrl.trim()) return;
    const payload: LlmProviderConfig = {
      id: editingId ?? `llm-${Date.now().toString(36)}`,
      name: name.trim(),
      providerType,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      defaultModel: defaultModel.trim(),
      availableModels: modelsCsv
        .split(/[,，]/)
        .map((m) => m.trim())
        .filter(Boolean),
      enabled,
    };
    const json = await apiPostJson<{ llmProviders: LlmProviderConfig[] }>(
      '/api/llm/providers',
      payload,
    );
    patchData({ llmProviders: json.llmProviders });
    setModalOpen(false);
    showToast(
      editingId
        ? t(`已更新模型网关「${payload.name}」`, `Updated LLM provider "${payload.name}"`)
        : t(`已接入模型网关「${payload.name}」`, `Added LLM provider "${payload.name}"`),
    );
  };

  const handleToggleEnabled = async (p: LlmProviderConfig) => {
    const json = await apiPostJson<{ llmProviders: LlmProviderConfig[] }>('/api/llm/providers', {
      ...p,
      enabled: !p.enabled,
    });
    patchData({ llmProviders: json.llmProviders });
    showToast(
      !p.enabled
        ? t(`已启用网关「${p.name}」`, `Enabled "${p.name}"`)
        : t(`已停用网关「${p.name}」`, `Disabled "${p.name}"`),
    );
  };

  const handleDeleteProvider = async () => {
    if (!deleteTarget) return;
    const json = await apiDeleteResource<{ llmProviders: LlmProviderConfig[] }>(
      `/api/llm/providers/${deleteTarget.id}`,
    );
    patchData({ llmProviders: json.llmProviders });
    setDeleteTarget(null);
    showToast(t(`已移除模型网关「${deleteTarget.name}」`, 'Deleted LLM provider'));
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-window border border-line bg-surface px-4 py-3 shadow-2xs">
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <Cpu size={15} className="text-accent" />
            {t('大模型网关', 'Pi AI Unified LLM Gateway Hub')}
          </div>
          <div className="text-[12.5px] text-muted-foreground">
            {t(
              '统一管理 OpenAI-Compatible、Anthropic 与 Google Gemini 端点；Live 模式下所有 5 类智能体会话均通过此网关进行真实流式推理',
              'Manage OpenAI-Compatible, Anthropic, and Google Gemini gateways powering all 5 Pi Durable agent surfaces',
            )}
          </div>
        </div>
        <Button variant="accent" size="sm" onClick={openCreateModal}>
          <Plus size={13} />
          {t('新增模型网关', 'Add LLM Gateway')}
        </Button>
      </div>

      {data.llmProviders.map((p, idx) => (
        <div key={p.id} className="card">
          <div className="card-header">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="card-title">{p.name}</h3>
                <span className={`badge ${p.enabled ? 'badge-ok' : 'badge-warn'}`}>
                  {p.enabled ? 'ENABLED' : 'DISABLED'}
                </span>
              </div>
              <div className="font-mono text-[12.5px] text-muted-foreground">
                [{p.providerType}] {p.baseUrl} · Default Model: {p.defaultModel}
              </div>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <span className={`badge ${p.lastTestedStatus === 'OK' ? 'badge-ok' : 'badge-warn'}`}>
                {p.lastTestedStatus ?? 'READY'}
              </span>
              <Button variant="secondary" size="xs" onClick={() => void handleToggleEnabled(p)}>
                {p.enabled ? t('停用', 'Disable') : t('启用', 'Enable')}
              </Button>
              <Button variant="secondary" size="xs" onClick={() => openEditModal(p)}>
                <Edit3 size={11.5} />
                {t('编辑', 'Edit')}
              </Button>
              {data.llmProviders.length > 1 && (
                <Button variant="ghost" size="xs" onClick={() => setDeleteTarget(p)}>
                  <Trash2 size={11.5} className="text-red" />
                </Button>
              )}
              <Button
                type="button"
                variant="accent" size="md"
                data-testid={idx === 0 ? 'ping-llm-gateway-btn' : `ping-llm-gateway-btn-${idx}`}
                disabled={testingId === p.id}
                onClick={() => void handlePing(p.id)}
              >
                {testingId === p.id
                  ? t('正在探测网关...', 'Testing Gateway...')
                  : t('测试本地 Pi 网关连接 (glm-5.3-flash)', 'Test Local Pi Gateway')}
              </Button>
            </div>
          </div>

          {p.lastTestedMessage && (
            <div
              data-testid={idx === 0 ? 'llm-ping-result' : `llm-ping-result-${idx}`} className="p-2.5 bg-inset rounded-[5px] font-mono text-[12.5px] mb-2.5"
            >
              {p.lastTestedMessage}
            </div>
          )}

          <div>
            <div className="text-[12.5px] font-semibold mb-1.5">
              {t('已发现可用模型列表', 'Discovered Models')} ({p.availableModels.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {p.availableModels.map((m) => (
                <span key={m} className={`badge ${m === p.defaultModel ? 'badge-accent' : ''}`}>
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={modalOpen}
        title={
          editingId
            ? t('编辑大模型服务网关', 'Edit LLM Gateway Provider')
            : t('新增大模型服务网关', 'Add LLM Gateway Provider')
        }
        confirmLabel={t('保存模型网关', 'Save Gateway')}
        onConfirm={() => void handleSaveProvider()}
        onClose={() => setModalOpen(false)}
      >
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">{t('网关名称', 'Gateway Name')} *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">{t('协议类型', 'Provider Type')}</label>
            <select
              className="select"
              value={providerType}
              onChange={(e) =>
                setProviderType(e.target.value as LlmProviderConfig['providerType'])
              }
            >
              <option value="OPENAI_COMPATIBLE">OPENAI_COMPATIBLE</option>
              <option value="ANTHROPIC">ANTHROPIC</option>
              <option value="GOOGLE_GEMINI">GOOGLE_GEMINI</option>
              <option value="CLOUDFLARE_AI">CLOUDFLARE_AI</option>
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">{t('API Base URL', 'API Base URL')} *</label>
            <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
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
            />
          </div>
          <div className="form-field">
            <label className="form-label">
              {t('候选模型列表 (逗号分隔)', 'Available Models')}
            </label>
            <input
              className="input"
              value={modelsCsv}
              onChange={(e) => setModelsCsv(e.target.value)}
            />
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('移除大模型服务网关', 'Delete LLM Provider')}
        description={deleteTarget ? `${deleteTarget.name} (${deleteTarget.baseUrl})` : ''}
        confirmLabel={t('确认移除', 'Delete')}
        danger
        onConfirm={() => void handleDeleteProvider()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function SystemSettingsView() {
  const { t, locale, setLocale, theme, themePreference, setTheme } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  if (!data) return null;

  const settings = data.systemSettings;

  const updateBackendSettings = async (patch: Record<string, unknown>, toastLabel?: string) => {
    const json = await apiPutJson<{ systemSettings: typeof settings }>('/api/settings', patch);
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
    <div className="card max-w-[860px]">
      <div className="card-header">
        <h3 className="card-title">
          {t('系统设置与工作区治理首选项', 'System Settings & Workspace Governance Preferences')}
        </h3>
      </div>

      <div className="flex flex-col gap-4">
        {/* Explicit Offline Demo Mock Mode Switch (ADR-0007) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            borderRadius: 8,
            background: settings.mockLlmMode ? 'var(--warn-soft)' : 'var(--surface-2)',
            border: '1px solid var(--line)',
          }}
        >
          <div>
            <strong>
              {t(
                '智能体离线演示（Mock 模式）',
                'Explicit Offline Demo Mock LLM Mode (ADR-0007)',
              )}
            </strong>
            <div className="text-[12.5px] text-muted-foreground mt-0.5">
              {t(
                '默认关闭（Live 模式强制连接真实 LLM 网关，失败时返回结构化诊断而绝不静默伪造回复）；开启后使用内置确定性 fauxProvider 演示完整 5 步工具流。',
                'Off by default (Live mode strictly calls configured LLM gateways and reports LlmGatewayError when unreachable); turn on to run deterministic multi-step fauxProvider tool streams offline.',
              )}
            </div>
          </div>
          <label className="inline-flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <input
              type="checkbox"
              data-testid="mock-llm-mode-toggle"
              checked={Boolean(settings.mockLlmMode)}
              onChange={(e) =>
                void updateBackendSettings(
                  { mockLlmMode: e.target.checked },
                  e.target.checked
                    ? t('已开启离线演示 Mock 模式', 'Enabled Offline Demo Mock Mode')
                    : t('已切换回真实 Live LLM 网关模式', 'Switched to Live LLM Gateway Mode'),
                )
              }
            />
            <span className={`badge ${settings.mockLlmMode ? 'badge-warn' : 'badge-ok'}`}>
              {settings.mockLlmMode ? 'MOCK DEMO' : 'LIVE GATEWAY'}
            </span>
          </label>
        </div>

        {/* 3-State Segmented Theme Control */}
        <div className="flex flex-wrap justify-between items-center gap-3 pb-3.5 border-b border-line"
        >
          <div>
            <strong>{t('界面主题', 'Appearance Theme')}</strong>
            <div className="text-[12.5px] text-muted-foreground">
              {t(
                '支持跟随操作系统色温，或显式锁定暖纸亮色 (Warm Paper) / 胶片颗粒暗色 (Film Grain)',
                'Follow OS preference or pin Warm Paper Light / Film Grain Dark scheme',
              )}
            </div>
          </div>

          <div
            role="group"
            aria-label={t('界面外观主题选择', 'Appearance theme preference')} className="inline-flex p-0.75 rounded-[6px] bg-inset border border-line gap-1"
          >
            <Button
              type="button"
              data-testid="theme-pref-system"
              variant="toggle" size="sm" aria-pressed={themePreference === 'system'}
              onClick={() => handleSelectTheme('system')}
            >
              {t(
                `跟随系统 (${theme === 'light' ? '当前亮色' : '当前暗色'})`,
                `System (Currently ${theme})`,
              )}
            </Button>
            <Button
              type="button"
              data-testid="theme-pref-light"
              variant="toggle" size="sm" aria-pressed={themePreference === 'light'}
              onClick={() => handleSelectTheme('light')}
            >
              ☀ {t('亮色暖纸', 'Light')}
            </Button>
            <Button
              type="button"
              data-testid="theme-pref-dark"
              variant="toggle" size="sm" aria-pressed={themePreference === 'dark'}
              onClick={() => handleSelectTheme('dark')}
            >
              ☾ {t('暗色胶片', 'Dark')}
            </Button>
          </div>
        </div>

        {/* Bilingual Language Toggle */}
        <div className="flex flex-wrap justify-between items-center gap-3 pb-3.5 border-b border-line"
        >
          <div>
            <strong>{t('界面语言', 'Interface Language')}</strong>
            <div className="text-[12.5px] text-muted-foreground">
              {t(
                '支持简体中文 (zh-CN) 与英文 (en-US) 实时无刷切换',
                'Switch between Simplified Chinese (zh-CN) and English (en-US)',
              )}
            </div>
          </div>

          <div className="inline-flex p-0.75 rounded-[6px] bg-inset border border-line gap-1"
          >
            <Button
              type="button"
              variant="toggle" size="sm" aria-pressed={locale === 'zh-CN'}
              onClick={() => handleSelectLocale('zh-CN')}
            >
              简体中文 (zh-CN)
            </Button>
            <Button
              type="button"
              variant="toggle" size="sm" aria-pressed={locale === 'en-US'}
              onClick={() => handleSelectLocale('en-US')}
            >
              English (en-US)
            </Button>
          </div>
        </div>

        {/* Strict Validation Gate Switch */}
        <div className="flex justify-between items-center gap-3 pb-3.5 border-b border-line"
        >
          <div>
            <strong>
              {t(
                '一致性校验门禁',
                'Strict Consistency Validation Gate',
              )}
            </strong>
            <div className="text-[12.5px] text-muted-foreground">
              {t(
                '存在跨模型引用断链或类型契约冲突时，自动拦截四层应用开发包编译导出',
                'Block 4-layer development package compilation whenever Consistency Errors exist',
              )}
            </div>
          </div>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.strictValidation}
              onChange={(e) =>
                void updateBackendSettings(
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
        <div className="flex justify-between items-center gap-3 pb-3.5 border-b border-line"
        >
          <div>
            <strong>
              {t('本体文件自动镜像', 'Auto-Mirror Local YAML Files')}
            </strong>
            <div className="text-[12.5px] text-muted-foreground font-mono">
              {settings.workspaceDir}/model/{data.activeProject.id}/yaml/
            </div>
          </div>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoMirrorYaml}
              onChange={(e) =>
                void updateBackendSettings(
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

        <div className="flex justify-between items-center gap-3">
          <div>
            <strong>
              {t(
                '界面原型保存时自动萃取同步 MU 交互模型',
                'Auto-Sync MU UI Model from HTML Prototypes',
              )}
            </strong>
            <div className="text-[12.5px] text-muted-foreground">
              {t(
                '解析 HTML 原型中的 data-screen-id / data-element-id / data-event-id 锚点同步至 MU',
                'Deterministically extract semantic data-* anchors into MU on prototype save',
              )}
            </div>
          </div>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoSyncPrototypeMu}
              onChange={(e) =>
                void updateBackendSettings(
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
