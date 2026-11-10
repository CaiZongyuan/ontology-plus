import React, { useState } from 'react';
import {
  MODEL_FILE_NAMES,
  MODEL_STAGE_ORDER,
  serializeSuiteToYamlFiles,
  type ModelCode,
} from '../../packages/ontology-core/index.js';
import type { CompiledDevelopmentPackage } from '../../packages/package-compiler/index.js';
import { apiCompileDevPackage, useWorkbenchStore } from '../api.js';
import { usePreferences, type NavViewId } from '../i18n.js';

// ─── 1. Overview / Project Sessions (项目会话管理) ─────────────────────────────
export function OverviewSessionsView({
  onNavigate,
}: {
  onNavigate: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { data, switchProject, createNewProject } = useWorkbenchStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newTemplate, setNewTemplate] = useState<'CONTRACT' | 'MFT' | 'EMPTY'>('CONTRACT');

  if (!data) return null;
  const active = data.activeProject;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        <div className="card">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {t('当前激活本体工程', 'Active Ontology Project')}
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 600, marginTop: 4 }}>
            {active.name}
          </div>
          <div style={{ marginTop: 6 }}>
            <span className="badge badge-accent">{active.code}</span>{' '}
            <span className="badge badge-ok">
              {active.validation.presentModels.length}/11 {t('模型就绪', 'Models Ready')}
            </span>
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {t('两级一致性校验门禁', 'Two-Tier Validation Gate')}
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 600, marginTop: 4 }}>
            {active.validation.errorCount === 0
              ? t('0 一致性错误', '0 Consistency Errors')
              : `${active.validation.errorCount} Errors`}
          </div>
          <div style={{ marginTop: 6 }}>
            <span className="badge badge-ok">Tier 1: Strict</span>{' '}
            <span className="badge badge-warn">
              Tier 2: {active.validation.warningCount} Warnings
            </span>
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {t('四层架构资产与开发包', '4-Layer Assets & Packages')}
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 600, marginTop: 4 }}>
            {data.fourLayerAssets.length} {t('项标准资产', 'Assets')} ·{' '}
            {data.assembledApplications.length} {t('个应用', 'Apps')}
          </div>
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onNavigate('app-assembly-dev')}
            >
              {t('进入四层装配与开发包编译 →', 'Open 4-Layer Assembly →')}
            </button>
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {t('本地 Pi 智能体引擎', 'Local Pi Agent Runtime')}
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 600, marginTop: 4 }}>
            {data.llmProviders[0]?.defaultModel ?? 'auto/glm-5.3-flash'}
          </div>
          <div style={{ marginTop: 6 }}>
            <span className="badge badge-ok">127.0.0.1:3425</span>{' '}
            <span className="badge badge-accent">Pi Durable</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">{t('本体工程会话列表 (Project Sessions)', 'Ontology Project Sessions')}</h3>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreateOpen(true)}
          >
            + {t('新建本体工程', 'New Ontology Project')}
          </button>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>{t('工程编码', 'Code')}</th>
              <th>{t('工程名称', 'Project Name')}</th>
              <th>{t('所属中心', 'Center')}</th>
              <th>{t('业务领域', 'Domain')}</th>
              <th>{t('建模阶段进度', 'Stage Progress')}</th>
              <th>{t('操作', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.id}>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{p.code}</td>
                <td>
                  <strong>{p.name}</strong>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.description}</div>
                </td>
                <td>
                  <span className="badge badge-accent">{p.center}</span>
                </td>
                <td>{p.domain}</td>
                <td>
                  <span className="badge badge-ok">{p.currentStage} / 11 Models</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${p.id === active.id ? 'btn-primary' : ''}`}
                      onClick={async () => {
                        await switchProject(p.id);
                      }}
                    >
                      {p.id === active.id ? t('当前工程', 'Active') : t('切换至此工程', 'Switch')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        if (p.id !== active.id) await switchProject(p.id);
                        onNavigate('app-ontology');
                      }}
                    >
                      {t('打开 11 模型工作台', 'Open Workbench')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">{t('新建业务本体工程', 'Create Ontology Project')}</h3>
              <button type="button" className="btn btn-sm" onClick={() => setCreateOpen(false)}>
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label>{t('工程名称', 'Project Name')}</label>
                <input
                  className="input"
                  placeholder="例如：供应链采购协同系统"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label>{t('工程编码', 'Project Code')}</label>
                <input
                  className="input"
                  placeholder="例如：SCM-PROC"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                />
              </div>
              <div>
                <label>{t('业务领域', 'Domain')}</label>
                <input
                  className="input"
                  placeholder="例如：供应链采购管理"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                />
              </div>
              <div>
                <label>{t('初始化模板', 'Initial Template')}</label>
                <select
                  className="select"
                  value={newTemplate}
                  onChange={(e) =>
                    setNewTemplate(e.target.value as 'CONTRACT' | 'MFT' | 'EMPTY')
                  }
                >
                  <option value="CONTRACT">11模型完整标杆模板 (合同全生命周期 CLM)</option>
                  <option value="MFT">存量系统本体萃取模板 (MFT 安全传输)</option>
                  <option value="EMPTY">空白渐进式本体模板 (从 M1 开始)</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
                  {t('取消', 'Cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    if (!newName.trim()) return;
                    await createNewProject({
                      name: newName.trim(),
                      code: newCode.trim() || 'ONTO-NEW',
                      center: 'APPLICATION',
                      domain: newDomain.trim() || newName.trim(),
                      template: newTemplate,
                    });
                    setCreateOpen(false);
                  }}
                >
                  {t('立即创建', 'Create Project')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 2. Requirement Exploration (需求探索 / Grilling) ──────────────────────────
export function RequirementExploreView({
  onNavigate,
}: {
  onNavigate: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [inputMsg, setInputMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (!data) return null;
  const session = data.requirementSessions[0];

  const handleSendGrill = async () => {
    if (!inputMsg.trim() || !session || busy) return;
    setBusy(true);
    const text = inputMsg.trim();
    setInputMsg('');
    try {
      const res = await fetch(`/api/requirements/${session.id}/grill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage: text }),
      });
      const json = await res.json();
      patchData({
        requirementSessions: [json.session],
      });
      showToast('已更新需求探索追问并沉淀候选规则');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14 }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 540 }}>
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t('交互式需求探索与边界追问 (Requirement Grilling)', 'Requirement Exploration & Grilling')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{session?.title}</div>
          </div>
          <span className="badge badge-ok">{session?.status ?? 'CONVERGED'}</span>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '8px 0',
          }}
        >
          {(session?.messages ?? []).map((m) => (
            <div
              key={m.id}
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                background: m.role === 'user' ? 'var(--accent-soft)' : 'var(--surface-2)',
                border: '1px solid var(--line)',
                whiteSpace: 'pre-wrap',
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                {m.role === 'user'
                  ? t('业务需求提出方', 'Business Stakeholder')
                  : t('需求追问智能体 (Grilling Agent)', 'Requirement Grilling Agent')}
              </div>
              <div>{m.content}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            className="input"
            placeholder={t('输入新的业务需求或回答边界追问...', 'Enter business requirement or answer grilling question...')}
            value={inputMsg}
            onChange={(e) => setInputMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendGrill();
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={handleSendGrill}
          >
            {busy ? '...' : t('发送并追问', 'Send')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card">
          <h4 className="card-title" style={{ marginBottom: 8 }}>
            {t('已识别领域聚合根 (M1)', 'Discovered Aggregates (M1)')}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(session?.discoveredAggregates ?? []).map((a) => (
              <div key={a} className="badge badge-accent">
                {a}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h4 className="card-title" style={{ marginBottom: 8 }}>
            {t('已收敛业务规则 (M3)', 'Discovered Rules (M3)')}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(session?.discoveredRules ?? []).map((r) => (
              <div
                key={r}
                style={{
                  padding: '6px 8px',
                  borderRadius: 4,
                  background: 'var(--surface-2)',
                  fontSize: 12,
                }}
              >
                {r}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h4 className="card-title" style={{ marginBottom: 8 }}>
            {t('下一步转化动作', 'Next Actions')}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNavigate('app-req-docs')}
            >
              {t('查看/编辑《软件需求说明书》 →', 'Open SRS Document →')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onNavigate('app-ontology')}
            >
              {t('打开 11 模型本体工作台 →', 'Open 11-Model Ontology →')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 3. Requirement Documents (需求文档 SRS) ──────────────────────────────────
export function RequirementDocsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const doc = data?.requirementDocs[0];
  const [content, setContent] = useState(doc?.content ?? '');

  if (!data || !doc) return null;

  const handleSaveDoc = async () => {
    const res = await fetch('/api/requirements/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...doc,
        content,
        status: 'CONFIRMED',
      }),
    });
    const json = await res.json();
    patchData({ requirementDocs: json.docs });
    showToast('《软件需求说明书》已保存并标记为 CONFIRMED');
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card-header">
        <div>
          <h3 className="card-title">{doc.title}</h3>
          <span className="badge badge-ok">{doc.status}</span>{' '}
          <span className="badge badge-accent">{doc.version}</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleSaveDoc}>
          {t('保存并确认需求规格书', 'Save & Confirm SRS')}
        </button>
      </div>
      <textarea
        className="textarea mono"
        style={{ minHeight: 500 }}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
    </div>
  );
}

// ─── 4. UI Prototype & MU Sync (界面原型) ─────────────────────────────────────
export function PrototypeStudioView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const proto = data?.prototypes[0];
  const [htmlContent, setHtmlContent] = useState(proto?.htmlContent ?? '');
  const [viewMode, setViewMode] = useState<'SPLIT' | 'PREVIEW' | 'HTML'>('SPLIT');

  if (!data) return null;

  const handleSaveAndExtractMu = async () => {
    const res = await fetch(`/api/projects/${data.activeProject.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: proto?.id,
        name: proto?.name ?? '界面原型.html',
        version: 'v5.1',
        htmlContent,
        syncMu: true,
      }),
    });
    const json = await res.json();
    patchData({
      activeProject: json.project,
      prototypes: json.prototypes,
    });
    showToast(
      `已从 HTML 原型语义锚点提取 ${json.prototype.extractedScreenCount} 个屏幕并自动同步至 MU UI 模型`,
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <div>
            <h3 className="card-title">
              {t('可交互 HTML 界面原型与 MU 模型双向锚定工作台', 'Interactive HTML Prototype & MU Extractor')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '通过 data-screen-id / data-element-id / data-binding / data-behavior-ref 确定性生成 MU 屏幕模型与 ASCII 布局',
                'Deterministically extracts MU screens, elements, callChains, and ASCII layouts from semantic data-* anchors',
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'SPLIT' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('SPLIT')}
            >
              {t('分栏联调', 'Split View')}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'PREVIEW' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('PREVIEW')}
            >
              {t('仅看原型', 'Preview Only')}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'HTML' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('HTML')}
            >
              {t('HTML 源码', 'HTML Source')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              data-testid="sync-prototype-mu-btn"
              onClick={handleSaveAndExtractMu}
            >
              {t('保存原型并提取同步至 MU 模型', 'Save & Extract to MU Model')}
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: viewMode === 'SPLIT' ? '1.15fr 0.85fr' : '1fr',
          gap: 12,
        }}
      >
        {(viewMode === 'SPLIT' || viewMode === 'PREVIEW') && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <iframe
              title="Interactive Prototype Sandbox"
              sandbox="allow-same-origin"
              srcDoc={htmlContent}
              style={{ width: '100%', height: 560, border: 'none', display: 'block' }}
            />
          </div>
        )}
        {(viewMode === 'SPLIT' || viewMode === 'HTML') && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11.5, fontFamily: 'var(--mono)', marginBottom: 6 }}>
              界面原型.html (Semantic Anchors)
            </div>
            <textarea
              className="textarea mono"
              style={{ flex: 1, minHeight: 520 }}
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 5. Model Files & OWL / Skill / MCP Export (模型文件) ─────────────────────
export function ModelFilesView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [selectedCode, setSelectedCode] = useState<ModelCode>('M1');
  const [owlPreview, setOwlPreview] = useState<string | null>(null);

  if (!data) return null;
  const project = data.activeProject;
  const yamlFiles = serializeSuiteToYamlFiles(project.suite);

  const handleExportOwl = async () => {
    const res = await fetch(`/api/projects/${project.id}/owl`);
    const json = (await res.json()) as { owlXml: string };
    setOwlPreview(json.owlXml);
    showToast('已生成标准 W3C OWL/RDF 本体文件');
  };

  const handleGenerateSkill = async () => {
    const res = await fetch(`/api/projects/${project.id}/generate-skill`, {
      method: 'POST',
    });
    const json = await res.json();
    patchData({ generatedSkills: json.skills });
    showToast(`已生成业务本体技能包 ${json.skill.slug}`);
  };

  const handlePublishMcp = async () => {
    const res = await fetch(`/api/projects/${project.id}/publish-mcp`, {
      method: 'POST',
    });
    const json = await res.json();
    patchData({ mcpServers: json.mcpServers });
    showToast(`已将本体发布为在线 MCP Server (${json.mcp.endpoint})`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <div>
            <h3 className="card-title">
              {t('11 元模型 YAML 文件仓库与多形态导出', '11-Model YAML Repository & Multi-Format Export')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              .onto-cs/model/{project.id}/yaml/
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn"
              data-testid="export-owl-btn"
              onClick={handleExportOwl}
            >
              {t('导出 OWL 标准本体', 'Export OWL XML')}
            </button>
            <button
              type="button"
              className="btn"
              data-testid="generate-skill-btn"
              onClick={handleGenerateSkill}
            >
              {t('生成渐进式 SKILL.md', 'Generate SKILL.md')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="publish-mcp-btn"
              onClick={handlePublishMcp}
            >
              {t('发布为在线 MCP Server', 'Publish MCP Server')}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12 }}>
        <div className="card" style={{ padding: 8 }}>
          {MODEL_STAGE_ORDER.map((item) => {
            const fileName = MODEL_FILE_NAMES[item.code];
            const exists = Boolean(yamlFiles[item.code]);
            return (
              <button
                key={item.code}
                type="button"
                className={`nav-item ${selectedCode === item.code ? 'active' : ''}`}
                onClick={() => setSelectedCode(item.code)}
              >
                <span className="nav-item-left">
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{item.code}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{fileName}</span>
                </span>
                <span className={`badge ${exists ? 'badge-ok' : 'badge-warn'}`}>
                  {exists ? 'YAML' : 'Empty'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="card">
          <div className="card-header">
            <strong style={{ fontFamily: 'var(--mono)' }}>
              {MODEL_FILE_NAMES[selectedCode]}
            </strong>
            <span className="badge badge-accent">{selectedCode}</span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: 'var(--surface-2)',
              borderRadius: 5,
              fontFamily: 'var(--mono)',
              fontSize: 12,
              maxHeight: 500,
              overflow: 'auto',
            }}
          >
            {yamlFiles[selectedCode]?.content ?? `# ${selectedCode} not yet authored`}
          </pre>
        </div>
      </div>

      {owlPreview && (
        <div className="modal-backdrop" onClick={() => setOwlPreview(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">W3C OWL/RDF XML — {project.name}</h3>
              <button type="button" className="btn btn-sm" onClick={() => setOwlPreview(null)}>
                ✕
              </button>
            </div>
            <pre
              data-testid="owl-xml-preview"
              style={{
                padding: 12,
                background: 'var(--surface-2)',
                borderRadius: 5,
                fontFamily: 'var(--mono)',
                fontSize: 11.5,
                maxHeight: 420,
                overflow: 'auto',
              }}
            >
              {owlPreview}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 6. Four-Layer Architecture Assets (四层架构资产) ─────────────────────────
export function FourLayerAssetsView() {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  const [filterLayer, setFilterLayer] = useState<'ALL' | 'UI_UE' | 'TECH_FOUNDATION' | 'TECH_ARCH'>('ALL');

  if (!data) return null;
  const list =
    filterLayer === 'ALL'
      ? data.fourLayerAssets
      : data.fourLayerAssets.filter((a) => a.layer === filterLayer);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <div>
            <h3 className="card-title">
              {t('四层软件架构可复用资产库 (UI/UE · 技术底座 · 技术架构)', 'Four-Layer Architecture Reusable Asset Library')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '与业务本体自由组合装配，消除从领域模型到工程代码的架构漂移',
                'Freely assemble with any Ontology Suite to eliminate architectural drift',
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['ALL', 'UI_UE', 'TECH_FOUNDATION', 'TECH_ARCH'] as const).map((ly) => (
              <button
                key={ly}
                type="button"
                className={`btn btn-sm ${filterLayer === ly ? 'btn-primary' : ''}`}
                onClick={() => setFilterLayer(ly)}
              >
                {ly}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {list.map((asset) => (
          <div key={asset.id} className="card">
            <div className="card-header">
              <div>
                <span className="badge badge-accent" style={{ marginRight: 8 }}>
                  {asset.layer}
                </span>
                <strong>{asset.name}</strong>
              </div>
              <span className="badge badge-ok">{asset.version}</span>
            </div>
            <p style={{ color: 'var(--muted)', margin: '0 0 8px 0' }}>{asset.summary}</p>
            <pre
              style={{
                margin: 0,
                padding: 10,
                background: 'var(--surface-2)',
                borderRadius: 5,
                fontFamily: 'var(--mono)',
                fontSize: 11.5,
                whiteSpace: 'pre-wrap',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {asset.specMarkdown}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 7. Application Assembly & Dev Package Compiler (应用开发) ───────────────
export function ApplicationAssemblyDevView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [compiledPkg, setCompiledPkg] = useState<CompiledDevelopmentPackage | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('开发指导书.md');

  if (!data) return null;
  const app = data.assembledApplications[0];

  const handleCompilePackage = async () => {
    if (!app) return;
    try {
      const res = await apiCompileDevPackage(app.id);
      setCompiledPkg(res.compiledPackage);
      setSelectedFilePath('开发指导书.md');
      patchData({ assembledApplications: res.assembledApplications });
      showToast(
        `已成功编译渐进式《开发资料包》（共 ${res.compiledPackage.files.length} 个文件，已写入 ${res.compiledPackage.outputDir}）`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const activeFile = compiledPkg?.files.find((f) => f.relativePath === selectedFilePath);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t('四层架构应用组装与渐进式开发资料包编译器', 'Four-Layer Application Assembly & Development Package Compiler')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '将【业务本体层 + UI/UE设计层 + 技术底座层 + 技术架构层】编译为可直接喂给 Coding Agent 的渐进式披露开发包',
                'Compiles [Ontology + UI/UE + Tech Foundation + Tech Arch] into a progressive-disclosure Development Package',
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            data-testid="compile-dev-package-btn"
            onClick={handleCompilePackage}
          >
            {t('一键编译生成《开发资料包》', 'Compile Development Package')}
          </button>
        </div>

        {app && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 10,
              marginTop: 8,
            }}
          >
            <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>1. 业务本体层 (Ontology)</div>
              <div style={{ fontWeight: 600, marginTop: 3 }}>{data.activeProject.name}</div>
              <span className="badge badge-ok">
                {data.activeProject.validation.presentModels.length}/11 Models · 0 Errors
              </span>
            </div>
            <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>2. UI/UE 设计规范层</div>
              <div style={{ fontWeight: 600, marginTop: 3 }}>
                {data.fourLayerAssets.find((a) => a.id === app.uiUeAssetId)?.name}
              </div>
              <span className="badge badge-accent">Warm Paper / Film Grain</span>
            </div>
            <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>3. 技术底座层 (Foundation)</div>
              <div style={{ fontWeight: 600, marginTop: 3 }}>
                {data.fourLayerAssets.find((a) => a.id === app.techFoundationAssetId)?.name}
              </div>
              <span className="badge badge-accent">TS + Hono + SQLite/D1</span>
            </div>
            <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 5 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>4. 技术架构层 (Architecture)</div>
              <div style={{ fontWeight: 600, marginTop: 3 }}>
                {data.fourLayerAssets.find((a) => a.id === app.techArchAssetId)?.name}
              </div>
              <span className="badge badge-accent">DDD Deep Modules</span>
            </div>
          </div>
        )}
      </div>

      {compiledPkg && (
        <div
          style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12 }}
          data-testid="compiled-package-inspector"
        >
          <div className="card" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <div className="card-header">
              <h4 className="card-title">
                {t('开发资料包目录树', 'Package File Tree')} ({compiledPkg.files.length})
              </h4>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {compiledPkg.files.map((file) => (
                <button
                  key={file.relativePath}
                  type="button"
                  className={`nav-item ${selectedFilePath === file.relativePath ? 'active' : ''}`}
                  onClick={() => setSelectedFilePath(file.relativePath)}
                >
                  <span
                    className="nav-item-left"
                    style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}
                  >
                    {file.relativePath}
                  </span>
                  <span className="badge">{file.category}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <div className="card-header">
              <strong style={{ fontFamily: 'var(--mono)' }}>{activeFile?.relativePath}</strong>
              <span className="badge badge-ok">{activeFile?.sizeBytes} bytes</span>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: 'var(--surface-2)',
                borderRadius: 5,
                fontFamily: 'var(--mono)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              {activeFile?.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 8. Skills & Application Publish Views ───────────────────────────────────
export function OntologySkillsView() {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.generatedSkills.map((sk) => (
        <div key={sk.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{sk.name}</h3>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sk.description}</div>
            </div>
            <span className="badge badge-ok">v{sk.version}</span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: 'var(--surface-2)',
              borderRadius: 5,
              fontFamily: 'var(--mono)',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
            }}
          >
            {sk.skillMarkdown}
          </pre>
        </div>
      ))}
    </div>
  );
}

export function AppPublishView() {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.assembledApplications.map((app) => (
        <div key={app.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{app.name}</h3>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                {app.publishedEndpoint} · {app.packageOutputDir}
              </div>
            </div>
            <span className="badge badge-ok">
              {app.status} · {app.publishedVersion}
            </span>
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            {t('Agent 研发与发布流水日志', 'Agent Build & Release Logs')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {app.agentDevLogs.map((log, i) => (
              <div
                key={i}
                style={{
                  padding: '6px 10px',
                  background: 'var(--surface-2)',
                  borderRadius: 4,
                  fontFamily: 'var(--mono)',
                  fontSize: 11.5,
                }}
              >
                [{log.timestamp.slice(0, 19)}] <strong>{log.phase}</strong>: {log.detail}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

