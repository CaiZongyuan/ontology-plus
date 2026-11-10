import React, { useEffect, useState } from 'react';
import type {
  McpResourceDefinition,
  McpToolDefinition,
} from '../../packages/package-compiler/index.js';
import {
  apiCallMcpTool,
  apiInspectMcp,
  apiTestLlmProvider,
  useWorkbenchStore,
} from '../api.js';
import { usePreferences } from '../i18n.js';

// ─── 1. Capability Center: Legacy System Config (系统配置) ────────────────────
export function CapabilitySystemsView() {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t('存量业务系统接入配置 (Legacy Systems Registry)', 'Connected Enterprise Systems')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '接入既有 ERP、MFT、电子签章等存量系统，进行本体萃取与 Agent 化升级',
                'Register existing enterprise systems for Ontology Extraction and MCP wrapping',
              )}
            </div>
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>{t('系统编码', 'Code')}</th>
              <th>{t('系统名称', 'System Name')}</th>
              <th>{t('分类', 'Category')}</th>
              <th>{t('数据库方言', 'DB Dialect')}</th>
              <th>{t('服务地址', 'Base URL')}</th>
              <th>{t('本体化状态', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {data.legacySystems.map((sys) => (
              <tr key={sys.id}>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{sys.code}</td>
                <td>
                  <strong>{sys.name}</strong>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sys.description}</div>
                </td>
                <td>{sys.category}</td>
                <td style={{ fontFamily: 'var(--mono)' }}>{sys.dbDialect}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{sys.baseUrl}</td>
                <td>
                  <span className="badge badge-ok">{sys.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 2. Capability Center: Ontology Extraction (本体萃取 / 存量系统本体化) ────
export function CapabilityExtractionView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [title, setTitle] = useState('增量合同变更表与审批接口本体萃取');
  const [ddlSnippet, setDdlSnippet] = useState(
    `CREATE TABLE t_contract_amendment (\n  id VARCHAR(36) PRIMARY KEY,\n  contract_id VARCHAR(36) NOT NULL,\n  delta_amount DECIMAL(18,2) NOT NULL,\n  reason VARCHAR(255) NOT NULL\n);`,
  );

  if (!data) return null;

  const handleRunExtraction = async () => {
    const res = await fetch('/api/capability/extraction-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemId: data.legacySystems[0]?.id ?? 'sys-erp-contract',
        projectId: data.activeProject.id,
        title,
        sourceType: 'DDL_AND_OPENAPI',
        sourceSnippet: ddlSnippet,
      }),
    });
    const json = await res.json();
    patchData({ extractionJobs: json.extractionJobs });
    showToast(`本体萃取任务已完成：${json.job.summary}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t('存量业务系统本体萃取工作台 (Ontology Extraction)', 'Legacy System Ontology Extraction')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '融合存量系统数据库表结构 (DDL)、OpenAPI 接口文档与业务规范，自动提炼 M1~MI 领域本体模型',
                'Fuse SQL DDL, OpenAPI specs, and domain docs to extract structured M1-MI ontology models',
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="run-extraction-btn"
            onClick={handleRunExtraction}
          >
            {t('执行本体萃取任务', 'Run Ontology Extraction')}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('萃取任务名称', 'Extraction Task Title')}
            </label>
            <input
              className="input"
              style={{ marginBottom: 8 }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('源系统 DDL / OpenAPI 规范片段', 'Source SQL DDL / OpenAPI Snippet')}
            </label>
            <textarea
              className="textarea mono"
              style={{ minHeight: 160 }}
              value={ddlSnippet}
              onChange={(e) => setDdlSnippet(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {t('历史本体萃取任务记录', 'Completed Extraction Jobs')} (
              {data.extractionJobs.length})
            </div>
            {data.extractionJobs.map((job) => (
              <div
                key={job.id}
                style={{
                  padding: 10,
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{job.title}</strong>
                  <span className="badge badge-ok">
                    Confidence {(job.confidenceScore * 100).toFixed(0)}%
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>
                  {job.summary}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {job.extractedModels.map((m) => (
                    <span key={m} className="badge badge-accent">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 3. Capability Center: Dynamic MCP Server Hub (MCP 配置与在线调试) ────────
export function CapabilityMcpView() {
  const { t } = usePreferences();
  const { data, showToast } = useWorkbenchStore();
  const [caps, setCaps] = useState<{
    tools: McpToolDefinition[];
    resources: McpResourceDefinition[];
  } | null>(null);
  const [selectedTool, setSelectedTool] = useState<string>('m2_draftContract');
  const [toolArgsJson, setToolArgsJson] = useState<string>(
    JSON.stringify(
      {
        title: 'AI算力集群扩容采购合同',
        contractType: 'PROCUREMENT',
        counterpartyId: 'CP-001',
        totalAmount: 1650000,
        creditRating: 'AAA',
      },
      null,
      2,
    ),
  );
  const [rpcResponse, setRpcResponse] = useState<string>('');

  const projectId = data?.activeProject.id ?? 'proj-contract';

  useEffect(() => {
    apiInspectMcp(projectId).then((res) => {
      setCaps(res);
      if (res.tools[0]) setSelectedTool(res.tools[0].name);
    });
  }, [projectId]);

  if (!data) return null;

  const handleInvokeTool = async () => {
    try {
      const parsedArgs = JSON.parse(toolArgsJson);
      const res = await apiCallMcpTool(projectId, selectedTool, parsedArgs);
      setRpcResponse(JSON.stringify(res, null, 2));
      showToast(`已通过 JSON-RPC 2.0 调用 MCP 工具 ${selectedTool}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t('动态本体 MCP Server 服务中心与 JSON-RPC 调试台', 'Dynamic Ontology MCP Server Hub & Inspector')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              POST /api/mcp/{projectId} · Tools: {caps?.tools.length ?? 0} · Resources:{' '}
              {caps?.resources.length ?? 0}
            </div>
          </div>
          <span className="badge badge-ok">JSON-RPC 2.0 ONLINE</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {t('本体自动映射 MCP 工具列表 (M2 / M7 / MI)', 'Mapped MCP Tools')}
            </div>
            <div
              style={{
                maxHeight: 380,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {(caps?.tools ?? []).map((tool) => (
                <div
                  key={tool.name}
                  onClick={() => setSelectedTool(tool.name)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 5,
                    cursor: 'pointer',
                    background:
                      selectedTool === tool.name ? 'var(--accent-soft)' : 'var(--surface-2)',
                    border: '1px solid var(--line)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ fontFamily: 'var(--mono)' }}>{tool.name}</strong>
                    <span className="badge badge-accent">{tool.sourceModel}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                    {tool.description}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontFamily: 'var(--mono)' }}>
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
              style={{ minHeight: 140 }}
              value={toolArgsJson}
              onChange={(e) => setToolArgsJson(e.target.value)}
            />
            {rpcResponse && (
              <pre
                data-testid="mcp-rpc-response"
                style={{
                  margin: 0,
                  padding: 10,
                  background: 'var(--surface-2)',
                  borderRadius: 5,
                  fontFamily: 'var(--mono)',
                  fontSize: 11.5,
                  maxHeight: 220,
                  overflow: 'auto',
                }}
              >
                {rpcResponse}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 4. Capability Center: Agents, Cross-System Flows & Knowledge Center ─────
export function CapabilityAgentsView() {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.capabilityAgents.map((ag) => (
        <div key={ag.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{ag.name}</h3>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ag.role}</div>
            </div>
            <div>
              <span className="badge badge-accent">{ag.modelId}</span>{' '}
              <span className="badge badge-ok">{ag.status}</span>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>{t('挂载本体 MCP 服务', 'Mounted MCP Servers')}: </strong>
            {ag.mcpIds.map((id) => (
              <span key={id} className="badge badge-accent" style={{ marginRight: 6 }}>
                {id}
              </span>
            ))}
            <strong>{t('挂载技能包', 'Mounted Skills')}: </strong>
            {ag.skillIds.map((id) => (
              <span key={id} className="badge badge-ok" style={{ marginRight: 6 }}>
                {id}
              </span>
            ))}
          </div>
          <div
            style={{
              padding: 10,
              background: 'var(--surface-2)',
              borderRadius: 5,
              fontFamily: 'var(--mono)',
              fontSize: 12,
            }}
          >
            {ag.systemPrompt}
          </div>
        </div>
      ))}
    </div>
  );
}

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
    showToast('已执行跨系统 MCP 协同工作流，全部 4 个异构系统节点执行成功');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.crossSystemFlows.map((fl) => (
        <div key={fl.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{fl.name}</h3>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fl.description}</div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="execute-cross-flow-btn"
              onClick={() => handleRunFlow(fl.id)}
            >
              {t('演练执行跨系统协同流', 'Execute Cross-System Flow')}
            </button>
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
  const { data } = useWorkbenchStore();
  if (!data) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
      {data.knowledgeEntries.map((kn) => (
        <div key={kn.id} className="card">
          <div className="card-header">
            <h3 className="card-title">{kn.title}</h3>
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
  );
}

// ─── 5. Data Analytics Center Views (数据分析中心) ────────────────────────────
export function DataResourcesView() {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.databaseResources.map((db) => (
        <div key={db.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{db.name}</h3>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                {db.dialect} · {db.connectionUri}
              </div>
            </div>
            <span className="badge badge-ok">{db.status}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontFamily: 'var(--mono)' }}>{tb.tableName}</strong>
                  <span className="badge badge-accent">{tb.rowCount} rows</span>
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

      {data.dataDocuments.map((doc) => (
        <div key={doc.id} className="card">
          <div className="card-header">
            <h3 className="card-title">{doc.title}</h3>
            <span className="badge badge-accent">{doc.category}</span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 10,
              background: 'var(--surface-2)',
              borderRadius: 5,
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--sans)',
            }}
          >
            {doc.content}
          </pre>
        </div>
      ))}
    </div>
  );
}

export function DataMappingsView() {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">
          {t('数据本体与数仓物理表字段映射规则 (Data Ontology Mappings)', 'Data Ontology to Physical Column Mappings')}
        </h3>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('本体对象', 'Ontology Object')}</th>
            <th>{t('本体属性', 'Ontology Attribute')}</th>
            <th>{t('物理表.字段', 'Source Table.Column')}</th>
            <th>{t('清洗转换表达式', 'Transform Expression')}</th>
            <th>{t('数据质量门禁规则', 'Data Quality Rule')}</th>
          </tr>
        </thead>
        <tbody>
          {data.dataMappings.map((m) => (
            <tr key={m.id}>
              <td>
                <span className="badge badge-accent">{m.ontologyObject}</span>
              </td>
              <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{m.ontologyAttribute}</td>
              <td style={{ fontFamily: 'var(--mono)' }}>
                {m.sourceTable}.{m.sourceColumn}
              </td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{m.transformExpr}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{m.qualityRule}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataMetricsReportsView() {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {data.metrics.map((m) => (
          <div key={m.id} className="card">
            <div className="card-header">
              <span className="badge badge-accent">{m.code}</span>
              <span
                className={`badge ${m.status === 'NORMAL' ? 'badge-ok' : 'badge-warn'}`}
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
                margin: '6px 0',
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
          </div>
        ))}
      </div>

      {data.analyticsReports.map((rp) => (
        <div key={rp.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{rp.title}</h3>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {rp.period} · {rp.author}
              </div>
            </div>
            <span className="badge badge-ok">{t('已归档报告', 'Published Report')}</span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: 'var(--surface-2)',
              borderRadius: 5,
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--sans)',
            }}
          >
            {rp.markdownContent}
          </pre>
        </div>
      ))}
    </div>
  );
}

// ─── 6. Data Ontology Reasoning (本体推理：智能问数 / 问因 / 问策) ────────────
export function DataReasoningView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [mode, setMode] = useState<'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY'>('ASK_POLICY');
  const [question, setQuestion] = useState(
    '为什么本季度高风险合同逾期未结算率上升到了 14.8%？应该采取什么策略并回写业务系统？',
  );
  const [busy, setBusy] = useState(false);

  if (!data) return null;
  const activeSession = data.reasoningSessions[0];

  const handleRunReasoning = async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/analytics/reasoning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, mode }),
      });
      const json = await res.json();
      patchData({ reasoningSessions: json.reasoningSessions });
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
                '基于 M1 对象关联链、M3 业务规则阈值与 MM 数据表映射进行根因穿透，并一键触发回写接口闭环',
                'Traces M1 associations, M3 rule thresholds, and MM column mappings with closed-loop write-back',
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

        <div style={{ display: 'flex', gap: 8 }}>
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
      </div>

      {activeSession && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 14 }}>
          <div className="card">
            <div className="card-header">
              <h4 className="card-title">{t('三阶推理分析结论', 'Reasoning Conclusion')}</h4>
              <span className="badge badge-accent">{activeSession.mode}</span>
            </div>
            <pre
              style={{
                margin: '0 0 12px 0',
                padding: 12,
                background: 'var(--surface-2)',
                borderRadius: 5,
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--sans)',
              }}
            >
              {activeSession.answerMarkdown}
            </pre>

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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card">
              <h4 className="card-title" style={{ marginBottom: 8 }}>
                {t('智能问因：本体关联链归因因子', 'Causal Attribution Factors')}
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
                  <div style={{ fontWeight: 600 }}>{rec.actionTitle}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>
                    {rec.expectedImpact}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    data-testid="trigger-policy-writeback-btn"
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
      )}
    </div>
  );
}

export function DataWritebackView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  if (!data) return null;

  const handleExecute = async (id: string) => {
    const res = await fetch(`/api/analytics/writebacks/${id}/execute`, {
      method: 'POST',
    });
    const json = await res.json();
    patchData({ writebackInterfaces: json.writebackInterfaces });
    showToast(`回写接口 ${id} 执行成功`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.writebackInterfaces.map((wb) => (
        <div key={wb.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                {wb.id} · {wb.name}
              </h3>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                Target: {wb.targetSystem} ({wb.endpoint}) · Bound M2 Behavior: {wb.boundBehaviorRef}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-ok">
                {t('累计回写次数', 'Executions')}: {wb.executionCount}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleExecute(wb.id)}
              >
                {t('立即执行业务回写', 'Execute Write-Back')}
              </button>
            </div>
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

// ─── 7. LLM Center & System Settings (大模型中心 & 系统设置) ───────────────────
export function LlmCenterView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [testingId, setTestingId] = useState<string | null>(null);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.llmProviders.map((p) => (
        <div key={p.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{p.name}</h3>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                {p.baseUrl} · Default Model: {p.defaultModel}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`badge ${p.lastTestedStatus === 'OK' ? 'badge-ok' : 'badge-warn'}`}>
                {p.lastTestedStatus ?? 'READY'}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="ping-llm-gateway-btn"
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
              data-testid="llm-ping-result"
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
    </div>
  );
}

export function SystemSettingsView() {
  const { t, locale, toggleLocale, theme, toggleTheme } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <div className="card-header">
        <h3 className="card-title">{t('系统设置与工作区首选项', 'System Settings & Workspace Preferences')}</h3>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: 12,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div>
            <strong>{t('界面外观主题 (Spatial-Sync 双模)', 'Appearance Theme')}</strong>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('支持亮色暖纸 (Warm Paper) 与暗色胶片颗粒 (Film Grain) 切换', 'Switch between Warm Paper Light and Film Grain Dark modes')}
            </div>
          </div>
          <button type="button" className="btn" onClick={toggleTheme}>
            {theme === 'light' ? '☀ Light (Warm Paper)' : '☾ Dark (Film Grain)'}
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: 12,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div>
            <strong>{t('界面多语言 (Bilingual i18n)', 'Interface Language')}</strong>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('支持简体中文 (zh-CN) 与英文 (en-US) 实时切换', 'Switch between Simplified Chinese (zh-CN) and English (en-US)')}
            </div>
          </div>
          <button type="button" className="btn" onClick={toggleLocale}>
            {locale === 'zh-CN' ? '简体中文 (zh-CN)' : 'English (en-US)'}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>{t('本地本体文件镜像目录', 'Local YAML Mirror Directory')}</strong>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              {data.systemSettings.workspaceDir}/model/{data.activeProject.id}/yaml/
            </div>
          </div>
          <span className="badge badge-ok">AUTO-MIRROR ENABLED</span>
        </div>
      </div>
    </div>
  );
}

