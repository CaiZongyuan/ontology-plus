import React, { useEffect, useRef, useState } from 'react';
import {
  MODEL_CODES,
  MODEL_FILE_NAMES,
  MODEL_STAGE_ORDER,
  serializeManifestJson,
  serializeSuiteToYamlFiles,
  type ModelCode,
} from '../../packages/ontology-core/index.js';
import type { CompiledDevelopmentPackage } from '../../packages/package-compiler/index.js';
import type { FourLayerAsset } from '../../packages/workspace-store/index.js';
import {
  apiCompileDevPackage,
  apiGeneratePrototype,
  apiGenerateTechArch,
  apiRefinePrototype,
  apiRunAppCodingAgent,
  apiSynthesizeOntologyFromPrototype,
  apiSynthesizeSrsDoc,
  triggerBrowserDownload,
  useWorkbenchStore,
} from '../api.js';
import { usePreferences, type NavViewId } from '../i18n.js';

// ─── Helper: Parse A/B Classification Tag on Requirement Decisions ────────────
function parseDecisionTag(raw: string): {
  tag: '[AI自动补全]' | '[待确认]' | '[已确认]';
  badgeClass: 'badge-accent' | 'badge-warn' | 'badge-ok';
  categoryLabelZh: string;
  categoryLabelEn: string;
  body: string;
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[AI自动补全]')) {
    return {
      tag: '[AI自动补全]',
      badgeClass: 'badge-accent',
      categoryLabelZh: 'A类默认补全',
      categoryLabelEn: 'Class-A Auto',
      body: trimmed.slice('[AI自动补全]'.length).trim(),
    };
  }
  if (trimmed.startsWith('[待确认]')) {
    return {
      tag: '[待确认]',
      badgeClass: 'badge-warn',
      categoryLabelZh: 'B类待确认',
      categoryLabelEn: 'Class-B Pending',
      body: trimmed.slice('[待确认]'.length).trim(),
    };
  }
  if (trimmed.startsWith('[已确认]')) {
    return {
      tag: '[已确认]',
      badgeClass: 'badge-ok',
      categoryLabelZh: 'B类已收敛',
      categoryLabelEn: 'Class-B Confirmed',
      body: trimmed.slice('[已确认]'.length).trim(),
    };
  }
  return {
    tag: '[已确认]',
    badgeClass: 'badge-ok',
    categoryLabelZh: '已收敛决策',
    categoryLabelEn: 'Confirmed',
    body: trimmed,
  };
}

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

  const pipelineSteps: {
    step: string;
    labelZh: string;
    labelEn: string;
    meta: string;
    targetView: NavViewId;
  }[] = [
    {
      step: '1',
      labelZh: '1.需求探索',
      labelEn: '1. Req Explore',
      meta: `${data.requirementSessions.length} ${t('会话', 'Sessions')}`,
      targetView: 'app-req-explore',
    },
    {
      step: '2',
      labelZh: '2.需求规格书',
      labelEn: '2. SRS Spec',
      meta: `${data.requirementDocs.length} ${t('份文档', 'Docs')}`,
      targetView: 'app-req-docs',
    },
    {
      step: '3',
      labelZh: '3.界面原型(MU)',
      labelEn: '3. Prototype (MU)',
      meta: `${data.prototypes[0]?.extractedScreenCount ?? 0} ${t('屏幕', 'Screens')}`,
      targetView: 'app-prototype',
    },
    {
      step: '4',
      labelZh: '4.11模型本体',
      labelEn: '4. 11-Model Ontology',
      meta: `${active.validation.presentModels.length}/11 Models`,
      targetView: 'app-ontology',
    },
    {
      step: '5',
      labelZh: '5.四层装配与开发包',
      labelEn: '5. 4-Layer Dev Pkg',
      meta: `${data.assembledApplications.length} ${t('个应用', 'Apps')}`,
      targetView: 'app-assembly-dev',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 4 KPI Cards */}
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

      {/* Quick Full-Lifecycle Workflow Pipeline Bar */}
      <div className="card">
        <div className="card-header" style={{ marginBottom: 10 }}>
          <div>
            <h3 className="card-title">
              {t(
                '应用中心全生命周期研发流水线 (End-to-End Ontology Pipeline)',
                'End-to-End Application Ontology Lifecycle Pipeline',
              )}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '1.需求探索 -> 2.需求规格书 -> 3.界面原型(MU) -> 4.11模型本体 -> 5.四层装配与开发包',
                '1. Requirement Explore -> 2. SRS Spec -> 3. Prototype (MU) -> 4. 11-Model Ontology -> 5. 4-Layer Dev Package',
              )}
            </div>
          </div>
          <span className="badge badge-accent">{active.domain}</span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 10,
          }}
        >
          {pipelineSteps.map((st, idx) => (
            <div
              key={st.step}
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'var(--surface-2)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 13 }}>{t(st.labelZh, st.labelEn)}</strong>
                {idx < pipelineSteps.length - 1 && (
                  <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>→</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <span className="badge badge-ok">{st.meta}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => onNavigate(st.targetView)}
                >
                  {t('进入', 'Open')} →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Project Sessions Table */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            {t('本体工程会话列表 (Project Sessions)', 'Ontology Project Sessions')}
          </h3>
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
              <div className="form-field">
                <label className="form-label">{t('工程名称', 'Project Name')}</label>
                <input
                  className="input"
                  placeholder="例如：供应链采购协同系统"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">{t('工程编码', 'Project Code')}</label>
                <input
                  className="input"
                  placeholder="例如：SCM-PROC"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">{t('业务领域', 'Domain')}</label>
                <input
                  className="input"
                  placeholder="例如：供应链采购管理"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">{t('初始化模板', 'Initial Template')}</label>
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
                    setNewName('');
                    setNewCode('');
                    setNewDomain('');
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
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [inputMsg, setInputMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [synthesizingSrs, setSynthesizingSrs] = useState(false);

  // New session modal/inline state
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionPrompt, setNewSessionPrompt] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);

  useEffect(() => {
    if (!data) return;
    const exists = data.requirementSessions.some((s) => s.id === selectedSessionId);
    if (!exists) {
      setSelectedSessionId(data.requirementSessions[0]?.id ?? '');
    }
  }, [data?.activeProject.id, data?.requirementSessions, selectedSessionId]);

  if (!data) return null;
  const sessions = data.requirementSessions;
  const session =
    sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? undefined;

  const handleCreateSession = async () => {
    const title =
      newSessionTitle.trim() ||
      `${data.activeProject.name} 需求探索会话 #${sessions.length + 1}`;
    setCreatingSession(true);
    try {
      const res = await fetch('/api/requirements/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: data.activeProject.id,
          title,
          initialPrompt: newSessionPrompt.trim() || undefined,
        }),
      });
      const json = await res.json();
      let nextSessions = json.requirementSessions ?? [...sessions, json.session];

      // If an initial prompt was provided, trigger first grilling turn immediately
      if (newSessionPrompt.trim() && json.session?.id) {
        const grillRes = await fetch(`/api/requirements/${json.session.id}/grill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userMessage: newSessionPrompt.trim() }),
        });
        const grillJson = await grillRes.json();
        if (grillJson.requirementSessions) {
          nextSessions = grillJson.requirementSessions;
        }
      }

      patchData({ requirementSessions: nextSessions });
      if (json.session?.id) {
        setSelectedSessionId(json.session.id);
      }
      setNewSessionTitle('');
      setNewSessionPrompt('');
      setNewSessionOpen(false);
      showToast(t(`已创建需求探索会话「${title}」`, `Created requirement session "${title}"`));
    } finally {
      setCreatingSession(false);
    }
  };

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
      const updatedList =
        json.requirementSessions ??
        sessions.map((s) => (s.id === json.session.id ? json.session : s));
      patchData({
        requirementSessions: updatedList,
      });
      showToast(
        t(
          '已完成 A/B 分级追问并更新候选聚合根与业务规则',
          'Updated A/B requirement grilling and candidate domain rules',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSynthesizeSrs = async () => {
    if (!session || synthesizingSrs) return;
    setSynthesizingSrs(true);
    try {
      const res = await apiSynthesizeSrsDoc(session.id);
      patchData({
        requirementDocs: res.docs,
        requirementSessions: res.requirementSessions,
      });
      showToast(
        t(
          `已一键合成 9 章节《${res.doc.title}》(${res.doc.version})`,
          `Synthesized 9-chapter SRS "${res.doc.title}" (${res.doc.version})`,
        ),
      );
      onNavigate('app-req-docs');
    } finally {
      setSynthesizingSrs(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Top Multi-Session Switcher & Creator Bar */}
      <div className="card">
        <div className="card-header" style={{ marginBottom: newSessionOpen ? 12 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 className="card-title">
              {t(
                '交互式需求探索与 A/B 分级追问 (Requirement Grilling)',
                'Interactive Requirement Exploration & A/B Grilling',
              )}
            </h3>
            {sessions.length > 0 && (
              <select
                className="select"
                style={{ width: 290 }}
                value={session?.id ?? ''}
                onChange={(e) => setSelectedSessionId(e.target.value)}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.status})
                  </option>
                ))}
              </select>
            )}
            {session && (
              <span className={`badge ${session.status === 'CONVERGED' ? 'badge-ok' : 'badge-accent'}`}>
                {session.status}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn"
              data-testid="new-req-session-btn"
              onClick={() => setNewSessionOpen((v) => !v)}
            >
              + {t('新建需求会话', 'New Req Session')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="synthesize-srs-btn"
              disabled={!session || synthesizingSrs}
              onClick={handleSynthesizeSrs}
            >
              {synthesizingSrs
                ? t('正在合成 9 章节规格书...', 'Synthesizing 9-Part SRS...')
                : t(
                    '一键合成 9 章节《软件需求规格说明书》',
                    'Synthesize 9-Chapter SRS Document',
                  )}
            </button>
          </div>
        </div>

        {newSessionOpen && (
          <div
            style={{
              padding: 12,
              borderRadius: 6,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="form-grid-2">
              <div className="form-field">
                <label className="form-label">{t('会话标题', 'Session Title')}</label>
                <input
                  className="input"
                  placeholder={t('例如：里程碑变更与违约金追索专题探索', 'e.g. Milestone & Penalty Rules Exploration')}
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">
                  {t('初始业务诉求描述 (可选)', 'Initial Requirement Prompt (Optional)')}
                </label>
                <input
                  className="input"
                  placeholder={t('输入核心业务场景，创建后自动启动 A/B 分级追问...', 'Describe core business need...')}
                  value={newSessionPrompt}
                  onChange={(e) => setNewSessionPrompt(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setNewSessionOpen(false)}>
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={creatingSession}
                onClick={handleCreateSession}
              >
                {creatingSession ? '...' : t('创建并进入会话', 'Create Session')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Conversation + Right Convergence Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 370px', gap: 14 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 520 }}>
          <div className="card-header">
            <div>
              <strong>{session?.title ?? t('暂无需求探索会话', 'No Requirement Session')}</strong>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {t(
                  'A 类常规项由 AI 自动补全免打扰；B 类核心业务边界自动追问消除歧义',
                  'Class-A defaults auto-filled quietly; Class-B core ambiguities surfaced for confirmation',
                )}
              </div>
            </div>
            <span className="badge badge-accent">
              {(session?.messages ?? []).length} {t('轮对话', 'Turns')}
            </span>
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
            {(session?.messages ?? []).length === 0 ? (
              <div style={{ padding: 18, color: 'var(--muted)', fontSize: 12.5 }}>
                {t(
                  '请在下方输入业务需求或点击“+ 新建需求会话”开始探索。',
                  'Enter a business requirement below or create a new session to start.',
                )}
              </div>
            ) : (
              (session?.messages ?? []).map((m) => (
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
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      color: 'var(--muted)',
                      marginBottom: 4,
                    }}
                  >
                    <span>
                      {m.role === 'user'
                        ? t('业务需求提出方', 'Business Stakeholder')
                        : t('需求追问智能体 (Grilling Agent)', 'Requirement Grilling Agent')}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)' }}>
                      {m.timestamp ? m.timestamp.slice(11, 19) : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{m.content}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              className="input"
              placeholder={t(
                '输入新的业务需求或回答 B 类边界追问（如：确认逾期超 30 天冻结结算单）...',
                'Enter business requirement or confirm Class-B boundary...',
              )}
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendGrill();
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !session}
              onClick={handleSendGrill}
            >
              {busy ? '...' : t('发送并追问', 'Send')}
            </button>
          </div>
        </div>

        {/* Right Panel: Decisions (A/B Tags), M1 Aggregates, M3 Rules & Next Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="card-header" style={{ marginBottom: 8 }}>
              <h4 className="card-title">
                {t('A/B 分级决策清单 (Decisions)', 'A/B Classification Decisions')}
              </h4>
              <span className="badge badge-accent">
                {(session?.resolvedDecisions ?? []).length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
              {(session?.resolvedDecisions ?? []).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {t('发送需求后将自动生成 [AI自动补全] 与 [待确认] 决策项', 'Send a message to populate Class-A/B decisions')}
                </div>
              ) : (
                (session?.resolvedDecisions ?? []).map((dec, idx) => {
                  const parsed = parseDecisionTag(dec);
                  return (
                    <div
                      key={`${idx}-${dec.slice(0, 18)}`}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 5,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--line)',
                        fontSize: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span className={`badge ${parsed.badgeClass}`}>{parsed.tag}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {t(parsed.categoryLabelZh, parsed.categoryLabelEn)}
                        </span>
                      </div>
                      <div style={{ lineHeight: 1.45 }}>{parsed.body}</div>
                      {parsed.tag === '[待确认]' && (
                        <div>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() =>
                              setInputMsg(`确认业务边界决策：${parsed.body}`)
                            }
                          >
                            {t('填入确认回复 →', 'Reply to Confirm →')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="card">
            <h4 className="card-title" style={{ marginBottom: 8 }}>
              {t('已识别领域聚合根 (M1)', 'Discovered Aggregates (M1)')}
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(session?.discoveredAggregates ?? []).map((a) => (
                <span key={a} className="badge badge-accent">
                  {a}
                </span>
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
    </div>
  );
}

// ─── 3. Requirement Documents (需求文档 SRS) ──────────────────────────────────
export function RequirementDocsView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [docTitle, setDocTitle] = useState<string>('');
  const [docVersion, setDocVersion] = useState<string>('v1.0');
  const [content, setContent] = useState<string>('');
  const [generatingProto, setGeneratingProto] = useState(false);
  const mdUploadRef = useRef<HTMLInputElement | null>(null);

  const docs = data?.requirementDocs ?? [];
  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? docs[0];

  useEffect(() => {
    if (!data) return;
    const list = data.requirementDocs;
    if (list.length === 0) {
      setSelectedDocId('');
      setDocTitle(`${data.activeProject.name} 软件需求规格说明书`);
      setDocVersion('v1.0');
      setContent('');
      return;
    }
    const found = list.find((d) => d.id === selectedDocId);
    if (!found) {
      const latest = list[list.length - 1];
      setSelectedDocId(latest.id);
      setDocTitle(latest.title);
      setDocVersion(latest.version);
      setContent(latest.content);
    }
  }, [data?.activeProject.id, data?.requirementDocs.length]);

  useEffect(() => {
    if (!selectedDoc) return;
    setDocTitle(selectedDoc.title);
    setDocVersion(selectedDoc.version);
    setContent(selectedDoc.content);
  }, [selectedDoc?.id, selectedDoc?.updatedAt]);

  if (!data) return null;

  const handleSaveDoc = async () => {
    const targetId = selectedDoc?.id ?? `doc-${Date.now()}`;
    const res = await fetch('/api/requirements/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: targetId,
        projectId: data.activeProject.id,
        title: docTitle.trim() || `${data.activeProject.name} 软件需求规格说明书`,
        version: docVersion.trim() || 'v1.0',
        content,
        status: 'CONFIRMED',
      }),
    });
    const json = await res.json();
    patchData({ requirementDocs: json.docs });
    setSelectedDocId(json.doc.id);
    showToast(
      t(
        '《软件需求说明书》已保存并标记为 CONFIRMED',
        'SRS Document saved and marked CONFIRMED',
      ),
    );
  };

  const handleUploadMdFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const baseTitle = file.name.replace(/\.(md|txt)$/i, '') || `${data.activeProject.name} 需求规格书`;
    const newId = `doc-upload-${Date.now()}`;
    const res = await fetch('/api/requirements/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newId,
        projectId: data.activeProject.id,
        title: baseTitle,
        version: 'v1.0',
        content: text,
        status: 'CONFIRMED',
      }),
    });
    const json = await res.json();
    patchData({ requirementDocs: json.docs });
    setSelectedDocId(json.doc.id);
    setDocTitle(json.doc.title);
    setDocVersion(json.doc.version);
    setContent(text);
    showToast(
      t(
        `已导入本地需求规格书「${file.name}」并保存`,
        `Imported and saved Markdown document "${file.name}"`,
      ),
    );
  };

  const handleDownloadMd = () => {
    const safeName = `${(docTitle || '软件需求规格说明书').replace(/[\\/:*?"<>|]+/g, '_')}-${docVersion || 'v1.0'}.md`;
    triggerBrowserDownload(safeName, content, 'text/markdown;charset=utf-8');
    showToast(t(`已下载 ${safeName}`, `Downloaded ${safeName}`));
  };

  const handleGeneratePrototype = async () => {
    if (generatingProto) return;
    setGeneratingProto(true);
    try {
      let targetDocId = selectedDoc?.id;
      if (!targetDocId && content.trim()) {
        const saveRes = await fetch('/api/requirements/docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `doc-${Date.now()}`,
            projectId: data.activeProject.id,
            title: docTitle.trim() || `${data.activeProject.name} 软件需求规格说明书`,
            version: docVersion.trim() || 'v1.0',
            content,
            status: 'CONFIRMED',
          }),
        });
        const saveJson = await saveRes.json();
        patchData({ requirementDocs: saveJson.docs });
        targetDocId = saveJson.doc.id;
      }

      const res = await apiGeneratePrototype(data.activeProject.id, {
        docId: targetDocId,
      });
      patchData({
        prototypes: res.prototypes,
        activeProject: res.project,
      });
      showToast(
        t(
          `已基于需求规格书生成可交互 HTML 原型（自动提取 ${res.prototype.extractedScreenCount} 个屏幕同步至 MU 模型）`,
          `Generated interactive HTML prototype (${res.prototype.extractedScreenCount} screens synced to MU)`,
        ),
      );
      onNavigate?.('app-prototype');
    } finally {
      setGeneratingProto(false);
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card-header" style={{ flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {docs.length > 0 && (
            <select
              className="select"
              style={{ width: 280 }}
              value={selectedDoc?.id ?? ''}
              onChange={(e) => setSelectedDocId(e.target.value)}
            >
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ({d.version} · {d.status})
                </option>
              ))}
            </select>
          )}
          <input
            className="input"
            style={{ width: 240 }}
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            placeholder={t('文档标题', 'Document Title')}
          />
          <input
            className="input"
            style={{ width: 84, fontFamily: 'var(--mono)' }}
            value={docVersion}
            onChange={(e) => setDocVersion(e.target.value)}
            placeholder="v1.0"
          />
          {selectedDoc && (
            <>
              <span className="badge badge-ok">{selectedDoc.status}</span>
              <span className="badge badge-accent">{selectedDoc.version}</span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={mdUploadRef}
            type="file"
            accept=".md,.txt"
            style={{ display: 'none' }}
            onChange={handleUploadMdFile}
          />
          <button
            type="button"
            className="btn"
            onClick={() => mdUploadRef.current?.click()}
          >
            {t('上传本地 .md', 'Upload .md')}
          </button>
          <button type="button" className="btn" onClick={handleDownloadMd}>
            {t('下载 .md', 'Download .md')}
          </button>
          <button type="button" className="btn" onClick={handleSaveDoc}>
            {t('保存并确认需求规格书', 'Save & Confirm SRS')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="generate-prototype-btn"
            disabled={generatingProto}
            onClick={handleGeneratePrototype}
          >
            {generatingProto
              ? t('正在生成交互原型...', 'Generating Prototype...')
              : t('基于此需求生成可交互 HTML 原型 →', 'Generate Interactive HTML Prototype →')}
          </button>
        </div>
      </div>

      <textarea
        className="textarea mono"
        style={{ minHeight: 520 }}
        placeholder={t(
          '# 软件需求规格说明书 (SRS)\n在此编写或上传 9 章节 Markdown 需求规格书...',
          '# Software Requirements Specification (SRS)\nWrite or upload 9-chapter Markdown specification...',
        )}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
    </div>
  );
}

// ─── 4. UI Prototype & MU Sync (界面原型) ─────────────────────────────────────
export function PrototypeStudioView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [selectedProtoId, setSelectedProtoId] = useState<string>('');
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [viewMode, setViewMode] = useState<'SPLIT' | 'PREVIEW' | 'HTML'>('SPLIT');

  // AI Prototype Refinement Assistant state
  const [refineInstruction, setRefineInstruction] = useState<string>('');
  const [refining, setRefining] = useState(false);
  const [synthesizingOntology, setSynthesizingOntology] = useState(false);
  const [synthesisSummary, setSynthesisSummary] = useState<{
    modelCount: number;
    errorCount: number;
  } | null>(null);
  const htmlUploadRef = useRef<HTMLInputElement | null>(null);

  const prototypes = data?.prototypes ?? [];
  const proto = prototypes.find((p) => p.id === selectedProtoId) ?? prototypes[0];

  // Sync selectedProtoId when project or prototype list changes
  useEffect(() => {
    if (!data) return;
    const list = data.prototypes;
    if (list.length === 0) {
      setSelectedProtoId('');
      setHtmlContent('');
      return;
    }
    if (!list.some((p) => p.id === selectedProtoId)) {
      setSelectedProtoId(list[0].id);
    }
  }, [data?.activeProject.id, data?.prototypes]);

  // Sync htmlContent whenever activeProject or selected prototype updates on server
  useEffect(() => {
    setHtmlContent(proto?.htmlContent ?? '');
  }, [data?.activeProject.id, proto?.id, proto?.updatedAt, proto?.htmlContent]);

  if (!data) return null;

  const handleSaveAndExtractMu = async () => {
    const res = await fetch(`/api/projects/${data.activeProject.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: proto?.id,
        name: proto?.name ?? '界面原型.html',
        version: proto?.version ?? 'v5.1',
        htmlContent,
        syncMu: true,
      }),
    });
    const json = await res.json();
    patchData({
      activeProject: json.project,
      prototypes: json.prototypes,
    });
    if (json.prototype?.id) {
      setSelectedProtoId(json.prototype.id);
    }
    showToast(
      `已从 HTML 原型语义锚点提取 ${json.prototype.extractedScreenCount} 个屏幕并自动同步至 MU UI 模型`,
    );
  };

  const handleUploadHtml = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const uploadedHtml = await file.text();
    setHtmlContent(uploadedHtml);
    const res = await fetch(`/api/projects/${data.activeProject.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name || '界面原型.html',
        version: 'v5.1',
        htmlContent: uploadedHtml,
        syncMu: true,
      }),
    });
    const json = await res.json();
    patchData({
      activeProject: json.project,
      prototypes: json.prototypes,
    });
    if (json.prototype?.id) {
      setSelectedProtoId(json.prototype.id);
    }
    showToast(
      `已导入原型「${file.name}」，提取 ${json.prototype.extractedScreenCount} 个屏幕并同步至 MU 模型`,
    );
  };

  const handleDownloadHtml = () => {
    const fileName = proto?.name?.endsWith('.html')
      ? proto.name
      : `${proto?.name ?? '界面原型'}.html`;
    triggerBrowserDownload(fileName, htmlContent, 'text/html;charset=utf-8');
    showToast(t(`已下载原型文件 ${fileName}`, `Downloaded ${fileName}`));
  };

  const handleRefinePrototype = async () => {
    const instruction = refineInstruction.trim();
    if (!instruction || refining) return;
    setRefining(true);
    try {
      const res = proto
        ? await apiRefinePrototype(data.activeProject.id, proto.id, instruction)
        : await apiGeneratePrototype(data.activeProject.id, { prompt: instruction });
      setHtmlContent(res.prototype.htmlContent);
      patchData({
        activeProject: res.project,
        prototypes: res.prototypes,
      });
      setSelectedProtoId(res.prototype.id);
      setRefineInstruction('');
      showToast(
        t(
          `AI 原型精修已完成，自动提取 ${res.prototype.extractedScreenCount} 个屏幕同步至 MU 模型`,
          `AI refined prototype & synced ${res.prototype.extractedScreenCount} screens to MU model`,
        ),
      );
    } finally {
      setRefining(false);
    }
  };

  const handleConfirmAndSynthesizeOntology = async () => {
    if (synthesizingOntology) return;
    setSynthesizingOntology(true);
    try {
      const res = await apiSynthesizeOntologyFromPrototype(data.activeProject.id, {
        prototypeId: proto?.id,
      });
      patchData({
        activeProject: res.project,
      });
      setSynthesisSummary({
        modelCount: res.synthesizedModels.length,
        errorCount: res.validation.errorCount,
      });
      showToast(
        `已确认原型并合成 ${res.synthesizedModels.length}/11 元模型本体 (${res.validation.errorCount} Consistency Errors)`,
      );
    } finally {
      setSynthesizingOntology(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Top Toolbar Card */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="card-header" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <h3 className="card-title">
                {t(
                  '可交互 HTML 界面原型与 MU 模型双向锚定工作台',
                  'Interactive HTML Prototype & MU Extractor',
                )}
              </h3>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {t(
                  '通过 data-screen-id / data-element-id / data-binding / data-event-id 确定性提取 MU 屏幕模型与 11 元模型本体',
                  'Deterministically extracts MU screens, bindings, events, and synthesizes full 11-model ontology',
                )}
              </div>
            </div>

            {prototypes.length > 0 && (
              <select
                className="select"
                style={{ width: 230 }}
                value={proto?.id ?? ''}
                onChange={(e) => setSelectedProtoId(e.target.value)}
              >
                {prototypes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.version} · {p.extractedScreenCount} Screens)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              ref={htmlUploadRef}
              type="file"
              accept=".html,.htm"
              style={{ display: 'none' }}
              onChange={handleUploadHtml}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => htmlUploadRef.current?.click()}
            >
              {t('上传 .html', 'Upload .html')}
            </button>
            <button type="button" className="btn btn-sm" onClick={handleDownloadHtml}>
              {t('下载 .html', 'Download .html')}
            </button>

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
              className="btn btn-sm"
              data-testid="sync-prototype-mu-btn"
              onClick={handleSaveAndExtractMu}
            >
              {t('保存原型并提取同步至 MU 模型', 'Save & Extract to MU Model')}
            </button>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              data-testid="confirm-prototype-synthesize-btn"
              disabled={synthesizingOntology}
              onClick={handleConfirmAndSynthesizeOntology}
            >
              {synthesizingOntology
                ? t('正在合成 11 模型...', 'Synthesizing 11 Models...')
                : t(
                    '确认原型并一键合成 11 元模型本体',
                    'Confirm Prototype & Synthesize 11-Model Ontology',
                  )}
            </button>
          </div>
        </div>

        {/* AI Prototype Assistant Bar */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span className="badge badge-accent">
            {t('AI 原型精修助手', 'AI Prototype Assistant')}
          </span>
          <input
            className="input"
            style={{ flex: 1, minWidth: 260 }}
            data-testid="refine-prototype-input"
            placeholder={t(
              '输入界面精修指令，例如：增加里程碑逾期预警统计卡片与批量审批按钮（自动保持语义锚点并同步 MU）...',
              'Describe UI refinement, e.g. Add overdue milestone KPI banner and batch approve modal...',
            )}
            value={refineInstruction}
            onChange={(e) => setRefineInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRefinePrototype();
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            data-testid="refine-prototype-btn"
            disabled={refining || !refineInstruction.trim()}
            onClick={handleRefinePrototype}
          >
            {refining ? t('精修中...', 'Refining...') : t('AI 精修并同步 MU', 'Refine & Sync MU')}
          </button>
        </div>

        {/* Post-Synthesis Banner with Jump to 11-Model Workbench */}
        {synthesisSummary && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              background: 'var(--ok-soft)',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12.5 }}>
              <strong>
                {t('11 元模型本体已就绪：', '11-Model Ontology Synthesized: ')}
              </strong>
              {synthesisSummary.modelCount}/11 Models · {synthesisSummary.errorCount} Consistency Errors
            </div>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => onNavigate?.('app-ontology')}
            >
              {t('前往 11 模型本体工作台查看 →', 'Open 11-Model Ontology Workbench →')}
            </button>
          </div>
        )}
      </div>

      {/* Sandbox Preview + HTML Source Split Area */}
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
              sandbox="allow-scripts"
              srcDoc={htmlContent}
              style={{ width: '100%', height: 560, border: 'none', display: 'block' }}
            />
          </div>
        )}
        {(viewMode === 'SPLIT' || viewMode === 'HTML') && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11.5,
                fontFamily: 'var(--mono)',
                marginBottom: 6,
              }}
            >
              <span>{proto?.name ?? '界面原型.html'} (Semantic Anchors)</span>
              <span className="badge badge-ok">
                {proto?.extractedScreenCount ?? data.activeProject.suite.MU?.screens.length ?? 0}{' '}
                MU Screens
              </span>
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
  const [selectedFile, setSelectedFile] = useState<'MANIFEST' | ModelCode>('M1');
  const [owlPreview, setOwlPreview] = useState<string | null>(null);
  const [owlFileName, setOwlFileName] = useState<string>('ontology.owl');
  const [importErrors, setImportErrors] = useState<{ model: ModelCode; message: string }[]>([]);
  const yamlImportRef = useRef<HTMLInputElement | null>(null);

  if (!data) return null;
  const project = data.activeProject;
  const yamlFiles = serializeSuiteToYamlFiles(project.suite);

  // Build canonical relative-path manifest.json per §14.3
  const manifestModels: Record<string, string> = {};
  for (const item of MODEL_STAGE_ORDER) {
    if (project.suite[item.code]) {
      manifestModels[item.code] = `yaml/${MODEL_FILE_NAMES[item.code]}`;
    }
  }
  const manifestContent = serializeManifestJson({
    version: '1.0',
    projectId: project.id,
    domain: project.domain || project.name,
    models: manifestModels,
  });

  const handleExportOwl = async () => {
    const res = await fetch(`/api/projects/${project.id}/owl`);
    const json = (await res.json()) as { owlXml: string; fileName?: string };
    setOwlPreview(json.owlXml);
    setOwlFileName(json.fileName || `${project.code.toLowerCase()}-ontology.owl`);
    showToast(t('已生成标准 W3C OWL/RDF 本体文件', 'Generated W3C OWL/RDF XML'));
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

  const handleImportYamlFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const filesMap: Record<string, string> = {};

    for (const file of Array.from(fileList)) {
      const content = await file.text();
      filesMap[file.name] = content;
      // Also map shorthand names like m1.yaml -> M1
      for (const code of MODEL_CODES) {
        const canonicalName = MODEL_FILE_NAMES[code].toLowerCase();
        const lower = file.name.toLowerCase();
        if (lower === canonicalName || lower.startsWith(`${code.toLowerCase()}-`) || lower === `${code.toLowerCase()}.yaml` || lower === `${code.toLowerCase()}.yml`) {
          filesMap[code] = content;
        }
      }
    }
    e.target.value = '';

    const res = await fetch(`/api/projects/${project.id}/yaml/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: filesMap }),
    });
    const json = (await res.json()) as {
      project: typeof project;
      parseErrors: { model: ModelCode; message: string }[];
    };

    patchData({ activeProject: json.project });
    setImportErrors(json.parseErrors ?? []);

    if (json.parseErrors && json.parseErrors.length > 0) {
      showToast(
        t(
          `YAML 导入部分完成，发现 ${json.parseErrors.length} 个解析错误`,
          `YAML imported with ${json.parseErrors.length} parse error(s)`,
        ),
      );
    } else {
      showToast(
        t(
          `已成功导入 ${Object.keys(filesMap).length} 项模型文件并通过 AST 归一化`,
          'Successfully imported YAML model files into typed AST',
        ),
      );
    }
  };

  const handleDownloadCurrentFile = () => {
    if (selectedFile === 'MANIFEST') {
      triggerBrowserDownload('manifest.json', manifestContent, 'application/json;charset=utf-8');
      showToast(t('已下载 manifest.json', 'Downloaded manifest.json'));
      return;
    }
    const fileName = MODEL_FILE_NAMES[selectedFile];
    const text = yamlFiles[selectedFile]?.content ?? `# ${selectedFile} not yet authored\n`;
    triggerBrowserDownload(fileName, text, 'text/yaml;charset=utf-8');
    showToast(t(`已下载 ${fileName}`, `Downloaded ${fileName}`));
  };

  const currentTitle =
    selectedFile === 'MANIFEST' ? 'manifest.json' : MODEL_FILE_NAMES[selectedFile];
  const currentContent =
    selectedFile === 'MANIFEST'
      ? manifestContent
      : (yamlFiles[selectedFile]?.content ?? `# ${selectedFile} not yet authored`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">
              {t(
                '11 元模型 YAML 文件仓库与多形态导出',
                '11-Model YAML Repository & Multi-Format Export',
              )}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              .onto-cs/model/{project.id}/
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={yamlImportRef}
              type="file"
              multiple
              accept=".yaml,.yml,.json"
              style={{ display: 'none' }}
              onChange={handleImportYamlFiles}
            />
            <button
              type="button"
              className="btn"
              onClick={() => yamlImportRef.current?.click()}
            >
              {t('导入 YAML 文件', 'Import YAML Files')}
            </button>
            <button type="button" className="btn" onClick={handleDownloadCurrentFile}>
              {t('下载当前文件', 'Download Current File')}
            </button>
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

      {importErrors.length > 0 && (
        <div
          className="card"
          style={{ borderColor: 'var(--bad)', background: 'var(--bad-soft)' }}
        >
          <div className="card-header" style={{ marginBottom: 6 }}>
            <strong>{t('YAML 导入解析诊断 (Parse Errors)', 'YAML Import Parse Errors')}</strong>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setImportErrors([])}
            >
              {t('清除提示', 'Dismiss')}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {importErrors.map((err, i) => (
              <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                <strong>[{err.model}]</strong> {err.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '270px 1fr', gap: 12 }}>
        <div className="card" style={{ padding: 8 }}>
          {/* manifest.json entry */}
          <button
            type="button"
            className={`nav-item ${selectedFile === 'MANIFEST' ? 'active' : ''}`}
            onClick={() => setSelectedFile('MANIFEST')}
          >
            <span className="nav-item-left">
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>IDX</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>manifest.json</span>
            </span>
            <span className="badge badge-accent">JSON</span>
          </button>

          {/* 11 Model YAML entries */}
          {MODEL_STAGE_ORDER.map((item) => {
            const fileName = MODEL_FILE_NAMES[item.code];
            const exists = Boolean(yamlFiles[item.code]);
            return (
              <button
                key={item.code}
                type="button"
                className={`nav-item ${selectedFile === item.code ? 'active' : ''}`}
                onClick={() => setSelectedFile(item.code)}
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
            <strong style={{ fontFamily: 'var(--mono)' }}>{currentTitle}</strong>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="badge badge-accent">{selectedFile}</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleDownloadCurrentFile}
              >
                {t('下载', 'Download')} {currentTitle}
              </button>
            </div>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: 'var(--surface-2)',
              borderRadius: 5,
              fontFamily: 'var(--mono)',
              fontSize: 12,
              maxHeight: 520,
              overflow: 'auto',
            }}
          >
            {currentContent}
          </pre>
        </div>
      </div>

      {owlPreview && (
        <div className="modal-backdrop" onClick={() => setOwlPreview(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">W3C OWL/RDF XML — {project.name}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    triggerBrowserDownload(
                      owlFileName,
                      owlPreview,
                      'application/rdf+xml;charset=utf-8',
                    );
                    showToast(t(`已下载 ${owlFileName}`, `Downloaded ${owlFileName}`));
                  }}
                >
                  {t('下载 OWL XML', 'Download OWL XML')}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setOwlPreview(null)}>
                  ✕
                </button>
              </div>
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
  const { data, patchData, showToast } = useWorkbenchStore();
  const [filterLayer, setFilterLayer] = useState<'ALL' | 'UI_UE' | 'TECH_FOUNDATION' | 'TECH_ARCH'>('ALL');

  // Asset Editor Modal State
  const [editingAsset, setEditingAsset] = useState<{
    id: string;
    layer: FourLayerAsset['layer'];
    name: string;
    version: string;
    summary: string;
    tagsText: string;
    specMarkdown: string;
  } | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);

  // AI Tech-Stack-to-Arch Generator State
  const [archName, setArchName] = useState('云原生 DDD 四层技术架构规范');
  const [archStackTags, setArchStackTags] = useState('TypeScript, Hono, React 19, Drizzle SQLite/D1');
  const [archPrompt, setArchPrompt] = useState('');
  const [generatingArch, setGeneratingArch] = useState(false);

  if (!data) return null;
  const list =
    filterLayer === 'ALL'
      ? data.fourLayerAssets
      : data.fourLayerAssets.filter((a) => a.layer === filterLayer);

  const openNewAssetModal = () => {
    const defaultLayer: FourLayerAsset['layer'] =
      filterLayer === 'ALL' ? 'TECH_ARCH' : filterLayer;
    setEditingAsset({
      id: `asset-${defaultLayer.toLowerCase()}-${Date.now()}`,
      layer: defaultLayer,
      name: '',
      version: 'v1.0',
      summary: '',
      tagsText: 'Standard, Reusable',
      specMarkdown: '# 架构资产规范说明\n\n## 1. 核心约束\n- ',
    });
  };

  const openEditAssetModal = (asset: FourLayerAsset) => {
    setEditingAsset({
      id: asset.id,
      layer: asset.layer,
      name: asset.name,
      version: asset.version,
      summary: asset.summary,
      tagsText: asset.tags.join(', '),
      specMarkdown: asset.specMarkdown,
    });
  };

  const handleSaveAsset = async () => {
    if (!editingAsset || !editingAsset.name.trim() || savingAsset) return;
    setSavingAsset(true);
    try {
      const tags = editingAsset.tagsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingAsset.id,
          layer: editingAsset.layer,
          name: editingAsset.name.trim(),
          version: editingAsset.version.trim() || 'v1.0',
          summary: editingAsset.summary.trim() || editingAsset.name.trim(),
          tags,
          specMarkdown: editingAsset.specMarkdown,
        }),
      });
      const json = await res.json();
      patchData({ fourLayerAssets: json.fourLayerAssets });
      setEditingAsset(null);
      showToast(t(`已保存四层架构资产「${json.asset.name}」`, `Saved asset "${json.asset.name}"`));
    } finally {
      setSavingAsset(false);
    }
  };

  const handleGenerateTechArch = async () => {
    if (generatingArch) return;
    setGeneratingArch(true);
    try {
      const stackTags = archStackTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiGenerateTechArch({
        name: archName.trim() || `${data.activeProject.name} 技术架构设计文档`,
        stackTags,
        prompt: archPrompt.trim() || undefined,
      });
      patchData({ fourLayerAssets: res.fourLayerAssets });
      setFilterLayer('TECH_ARCH');
      showToast(
        t(
          `AI 已根据技术栈生成《${res.asset.name}》并入库 TECH_ARCH 资产层`,
          `Generated TECH_ARCH asset "${res.asset.name}"`,
        ),
      );
    } finally {
      setGeneratingArch(false);
    }
  };

  const layerLabels: Record<'ALL' | FourLayerAsset['layer'], { zh: string; en: string }> = {
    ALL: { zh: '全部资产 (ALL)', en: 'ALL' },
    UI_UE: { zh: 'UI/UE 设计规范 (UI_UE)', en: 'UI_UE' },
    TECH_FOUNDATION: { zh: '技术底座规范 (TECH_FOUNDATION)', en: 'TECH_FOUNDATION' },
    TECH_ARCH: { zh: '技术架构文档 (TECH_ARCH)', en: 'TECH_ARCH' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header + Layer Filter Tabs */}
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">
              {t(
                '四层软件架构可复用资产库 (UI/UE · 技术底座 · 技术架构)',
                'Four-Layer Architecture Reusable Asset Library',
              )}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '与业务本体自由组合装配，支持在线编辑规范文档与 AI 技术栈推导架构设计',
                'Freely assemble with any Ontology Suite, edit specs, or synthesize architecture docs from tech stack',
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['ALL', 'UI_UE', 'TECH_FOUNDATION', 'TECH_ARCH'] as const).map((ly) => (
              <button
                key={ly}
                type="button"
                className={`btn btn-sm ${filterLayer === ly ? 'btn-primary' : ''}`}
                onClick={() => setFilterLayer(ly)}
              >
                {t(layerLabels[ly].zh, layerLabels[ly].en)}
              </button>
            ))}
            <button type="button" className="btn btn-sm" onClick={openNewAssetModal}>
              + {t('新建架构资产', 'New Asset')}
            </button>
          </div>
        </div>
      </div>

      {/* AI Tech-Stack-to-Architecture Generator Panel */}
      <div className="card">
        <div className="card-header" style={{ marginBottom: 8 }}>
          <div>
            <h4 className="card-title">
              {t(
                'AI 技术栈一键生成《技术架构设计文档》(TECH_ARCH)',
                'AI Tech-Stack-to-Architecture Document Generator',
              )}
            </h4>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {t(
                '输入目标技术栈标签与架构诉求，自动生成分层职责、模块边界与部署拓扑规范',
                'Enter stack tags and constraints to synthesize a reusable TECH_ARCH specification',
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="generate-tech-arch-btn"
            disabled={generatingArch}
            onClick={handleGenerateTechArch}
          >
            {generatingArch
              ? t('正在生成架构文档...', 'Generating Tech Arch...')
              : t('AI 技术栈生成《技术架构设计文档》', 'Generate Tech Architecture Doc')}
          </button>
        </div>

        <div className="form-grid-3">
          <div className="form-field">
            <label className="form-label">{t('架构资产名称', 'Architecture Asset Name')}</label>
            <input
              className="input"
              value={archName}
              onChange={(e) => setArchName(e.target.value)}
              placeholder="例如：Spring Boot 3 + PostgreSQL 分层架构规范"
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('技术栈标签 (逗号分隔)', 'Tech Stack Tags')}</label>
            <input
              className="input"
              value={archStackTags}
              onChange={(e) => setArchStackTags(e.target.value)}
              placeholder="TypeScript, Hono, React 19, SQLite/D1"
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('补充架构约束 (可选)', 'Additional Constraints')}</label>
            <input
              className="input"
              value={archPrompt}
              onChange={(e) => setArchPrompt(e.target.value)}
              placeholder={t('例如：要求严格的 Deep Modules 边界与多租户隔离', 'e.g. Strict module boundaries & audit logging')}
            />
          </div>
        </div>
      </div>

      {/* Asset Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {list.map((asset) => (
          <div key={asset.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="card-header" style={{ marginBottom: 0 }}>
              <div>
                <span className="badge badge-accent" style={{ marginRight: 8 }}>
                  {asset.layer}
                </span>
                <strong>{asset.name}</strong>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="badge badge-ok">{asset.version}</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => openEditAssetModal(asset)}
                >
                  {t('编辑 Markdown', 'Edit')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    triggerBrowserDownload(
                      `${asset.id}.md`,
                      asset.specMarkdown,
                      'text/markdown;charset=utf-8',
                    )
                  }
                >
                  {t('下载', 'Download')}
                </button>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{asset.summary}</div>

            {asset.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {asset.tags.map((tg) => (
                  <span key={tg} className="badge">
                    {tg}
                  </span>
                ))}
              </div>
            )}

            <pre
              style={{
                margin: 0,
                padding: 10,
                background: 'var(--surface-2)',
                borderRadius: 5,
                fontFamily: 'var(--mono)',
                fontSize: 11.5,
                whiteSpace: 'pre-wrap',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {asset.specMarkdown}
            </pre>
          </div>
        ))}
      </div>

      {/* Markdown Asset Editor Modal */}
      {editingAsset && (
        <div className="modal-backdrop" onClick={() => setEditingAsset(null)}>
          <div
            className="modal-panel"
            style={{ maxWidth: 760 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 className="card-title">
                {t('编辑四层架构资产规范', 'Edit 4-Layer Architecture Asset')}
              </h3>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditingAsset(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="form-grid-3">
                <div className="form-field">
                  <label className="form-label">{t('所属架构层', 'Layer')}</label>
                  <select
                    className="select"
                    value={editingAsset.layer}
                    onChange={(e) =>
                      setEditingAsset({
                        ...editingAsset,
                        layer: e.target.value as FourLayerAsset['layer'],
                      })
                    }
                  >
                    <option value="UI_UE">UI_UE (UI/UE 设计规范层)</option>
                    <option value="TECH_FOUNDATION">TECH_FOUNDATION (技术底座层)</option>
                    <option value="TECH_ARCH">TECH_ARCH (技术架构层)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">{t('资产名称', 'Asset Name')}</label>
                  <input
                    className="input"
                    value={editingAsset.name}
                    onChange={(e) =>
                      setEditingAsset({ ...editingAsset, name: e.target.value })
                    }
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{t('版本号', 'Version')}</label>
                  <input
                    className="input"
                    value={editingAsset.version}
                    onChange={(e) =>
                      setEditingAsset({ ...editingAsset, version: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-field">
                  <label className="form-label">{t('规范摘要', 'Summary')}</label>
                  <input
                    className="input"
                    value={editingAsset.summary}
                    onChange={(e) =>
                      setEditingAsset({ ...editingAsset, summary: e.target.value })
                    }
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{t('技术标签 (逗号分隔)', 'Tags')}</label>
                  <input
                    className="input"
                    value={editingAsset.tagsText}
                    onChange={(e) =>
                      setEditingAsset({ ...editingAsset, tagsText: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="form-field">
                <label className="form-label">
                  {t('Markdown 规范正文', 'Specification Markdown')}
                </label>
                <textarea
                  className="textarea mono"
                  style={{ minHeight: 280 }}
                  value={editingAsset.specMarkdown}
                  onChange={(e) =>
                    setEditingAsset({ ...editingAsset, specMarkdown: e.target.value })
                  }
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditingAsset(null)}
                >
                  {t('取消', 'Cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={savingAsset || !editingAsset.name.trim()}
                  onClick={handleSaveAsset}
                >
                  {savingAsset ? '...' : t('保存架构资产', 'Save Asset')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 7. Application Assembly & Dev Package Compiler (应用开发) ───────────────
export function ApplicationAssemblyDevView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [compiledPkg, setCompiledPkg] = useState<CompiledDevelopmentPackage | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('开发指导书.md');

  // Interactive 4-Layer Assembly Creator / Updater State
  const [newAppOpen, setNewAppOpen] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [selProjectId, setSelProjectId] = useState('');
  const [selUiAssetId, setSelUiAssetId] = useState('');
  const [selFoundationId, setSelFoundationId] = useState('');
  const [selArchId, setSelArchId] = useState('');

  // In-Platform AI Coding Agent State
  const [codingInstruction, setCodingInstruction] = useState(
    '基于四层开发资料包与11元模型本体，生成聚合根仓储层、M2命令/M7查询服务及MU前端台账页面并执行门禁校验',
  );
  const [runningAgent, setRunningAgent] = useState(false);
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const apps = data?.assembledApplications ?? [];
  const app = apps.find((a) => a.id === selectedAppId) ?? apps[0];

  useEffect(() => {
    if (!data) return;
    if (apps.length > 0 && !apps.some((a) => a.id === selectedAppId)) {
      setSelectedAppId(apps[0].id);
    }
    const uiAssets = data.fourLayerAssets.filter((a) => a.layer === 'UI_UE');
    const fnAssets = data.fourLayerAssets.filter((a) => a.layer === 'TECH_FOUNDATION');
    const arAssets = data.fourLayerAssets.filter((a) => a.layer === 'TECH_ARCH');
    if (!selProjectId) setSelProjectId(data.activeProject.id);
    if (!selUiAssetId && uiAssets[0]) setSelUiAssetId(uiAssets[0].id);
    if (!selFoundationId && fnAssets[0]) setSelFoundationId(fnAssets[0].id);
    if (!selArchId && arAssets[0]) setSelArchId(arAssets[0].id);
  }, [data?.activeProject.id, data?.assembledApplications.length, data?.fourLayerAssets.length]);

  if (!data) return null;

  const uiAssets = data.fourLayerAssets.filter((a) => a.layer === 'UI_UE');
  const foundationAssets = data.fourLayerAssets.filter((a) => a.layer === 'TECH_FOUNDATION');
  const archAssets = data.fourLayerAssets.filter((a) => a.layer === 'TECH_ARCH');

  const handleUpdateLayerBinding = async (
    patch: Partial<{
      projectId: string;
      uiUeAssetId: string;
      techFoundationAssetId: string;
      techArchAssetId: string;
    }>,
  ) => {
    if (!app) return;
    const res = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...app,
        ...patch,
      }),
    });
    const json = await res.json();
    patchData({ assembledApplications: json.assembledApplications });
    showToast(t('已更新四层架构装配绑定', 'Updated 4-layer assembly binding'));
  };

  const handleCreateApplication = async () => {
    const targetProject =
      data.projects.find((p) => p.id === (selProjectId || data.activeProject.id)) ??
      data.activeProject;
    const name = newAppName.trim() || `${targetProject.name} 四层装配应用`;
    const res = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `app-${Date.now()}`,
        name,
        projectId: targetProject.id,
        uiUeAssetId: selUiAssetId || uiAssets[0]?.id || '',
        techFoundationAssetId: selFoundationId || foundationAssets[0]?.id || '',
        techArchAssetId: selArchId || archAssets[0]?.id || '',
        status: 'ASSEMBLED',
        publishedVersion: 'v1.0.0',
        publishedEndpoint: `/apps/${targetProject.code.toLowerCase()}`,
        agentDevLogs: [
          {
            timestamp: new Date().toISOString(),
            phase: 'FOUR_LAYER_ASSEMBLED',
            detail: `完成 [${targetProject.name}] 与四层架构资产组装`,
          },
        ],
      }),
    });
    const json = await res.json();
    patchData({ assembledApplications: json.assembledApplications });
    setSelectedAppId(json.application.id);
    setNewAppName('');
    setNewAppOpen(false);
    showToast(t(`已创建装配应用「${name}」`, `Created assembled application "${name}"`));
  };

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

  const handleDownloadPackageZip = async () => {
    if (!app || downloadingZip) return;
    setDownloadingZip(true);
    try {
      const res = await fetch(`/api/applications/${app.id}/package.zip`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'ZIP export failed' }));
        showToast(errJson.error || 'ZIP export failed');
        return;
      }
      const disposition = res.headers.get('Content-Disposition') || '';
      const nameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const fileName = nameMatch?.[1] || `${app.id}-dev-package.zip`;
      const blob = await res.blob();
      triggerBrowserDownload(fileName, blob, 'application/zip');
      showToast(t(`已下载开发资料包 ${fileName}`, `Downloaded ${fileName}`));
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleRunCodingAgent = async () => {
    if (!app || runningAgent) return;
    setRunningAgent(true);
    try {
      const instruction =
        codingInstruction.trim() ||
        '基于开发资料包执行全栈领域代码与校验门禁构建';
      const res = await apiRunAppCodingAgent(app.id, instruction);
      patchData({ assembledApplications: res.assembledApplications });
      setAgentReply(res.reply);
      showToast(
        t(
          `AI 研发智能体已完成构建任务（生成/校验 ${res.generatedFilesCount} 项工程产物）`,
          `AI Coding Agent finished (${res.generatedFilesCount} artifacts processed)`,
        ),
      );
    } finally {
      setRunningAgent(false);
    }
  };

  const activeFile = compiledPkg?.files.find((f) => f.relativePath === selectedFilePath);
  const boundProject =
    data.projects.find((p) => p.id === app?.projectId) ?? data.activeProject;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Top 4-Layer Selector & Compiler Card */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <h3 className="card-title">
                {t(
                  '四层架构应用组装与渐进式开发资料包编译器',
                  'Four-Layer Application Assembly & Development Package Compiler',
                )}
              </h3>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {t(
                  '自由选择【业务本体 + UI/UE设计 + 技术底座 + 技术架构】编译渐进式披露开发包或启动内置 AI Coding Agent',
                  'Assemble [Ontology + UI/UE + Tech Foundation + Tech Arch] into progressive-disclosure dev package & ZIP',
                )}
              </div>
            </div>

            {apps.length > 0 && (
              <select
                className="select"
                style={{ width: 260 }}
                value={app?.id ?? ''}
                onChange={(e) => {
                  setSelectedAppId(e.target.value);
                  setCompiledPkg(null);
                  setAgentReply(null);
                }}
              >
                {apps.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.status})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              onClick={() => setNewAppOpen((v) => !v)}
            >
              + {t('新建四层装配应用', 'New Assembled App')}
            </button>
            <button
              type="button"
              className="btn"
              data-testid="download-package-zip-btn"
              disabled={!app || downloadingZip}
              onClick={handleDownloadPackageZip}
            >
              {downloadingZip
                ? t('正在打包...', 'Packaging...')
                : t('下载 .zip 开发资料包', 'Download .zip Dev Package')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="compile-dev-package-btn"
              disabled={!app}
              onClick={handleCompilePackage}
            >
              {t('一键编译生成《开发资料包》', 'Compile Development Package')}
            </button>
          </div>
        </div>

        {/* Inline Creator for New AssembledApplication */}
        {newAppOpen && (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 6,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="form-grid-3">
              <div className="form-field">
                <label className="form-label">{t('应用名称', 'Application Name')}</label>
                <input
                  className="input"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  placeholder={t('例如：合同履约管理微服务应用', 'e.g. Contract Management App')}
                />
              </div>
              <div className="form-field">
                <label className="form-label">1. {t('业务本体工程', 'Ontology Project')}</label>
                <select
                  className="select"
                  value={selProjectId}
                  onChange={(e) => setSelProjectId(e.target.value)}
                >
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">2. {t('UI/UE 设计资产', 'UI/UE Asset')}</label>
                <select
                  className="select"
                  value={selUiAssetId}
                  onChange={(e) => setSelUiAssetId(e.target.value)}
                >
                  {uiAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.version})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-field">
                <label className="form-label">3. {t('技术底座资产', 'Tech Foundation')}</label>
                <select
                  className="select"
                  value={selFoundationId}
                  onChange={(e) => setSelFoundationId(e.target.value)}
                >
                  {foundationAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.version})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">4. {t('技术架构资产', 'Tech Architecture')}</label>
                <select
                  className="select"
                  value={selArchId}
                  onChange={(e) => setSelArchId(e.target.value)}
                >
                  {archAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.version})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setNewAppOpen(false)}>
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={handleCreateApplication}
              >
                {t('确认组装应用', 'Create Assembled Application')}
              </button>
            </div>
          </div>
        )}

        {/* Interactive 4-Layer Binding Cards */}
        {app && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 10,
              marginTop: 8,
            }}
          >
            <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 5, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                1. {t('业务本体层 (Ontology)', 'Ontology Layer')}
              </div>
              <select
                className="select"
                value={app.projectId}
                onChange={(e) => handleUpdateLayerBinding({ projectId: e.target.value })}
              >
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <span className="badge badge-ok">
                {boundProject.currentStage}/11 Models · 0 Errors
              </span>
            </div>

            <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 5, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                2. {t('UI/UE 设计规范层', 'UI/UE Design Layer')}
              </div>
              <select
                className="select"
                value={app.uiUeAssetId}
                onChange={(e) => handleUpdateLayerBinding({ uiUeAssetId: e.target.value })}
              >
                {uiAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span className="badge badge-accent">Warm Paper / Film Grain</span>
            </div>

            <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 5, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                3. {t('技术底座层 (Foundation)', 'Tech Foundation Layer')}
              </div>
              <select
                className="select"
                value={app.techFoundationAssetId}
                onChange={(e) =>
                  handleUpdateLayerBinding({ techFoundationAssetId: e.target.value })
                }
              >
                {foundationAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span className="badge badge-accent">TS + Hono + SQLite/D1</span>
            </div>

            <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 5, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                4. {t('技术架构层 (Architecture)', 'Tech Architecture Layer')}
              </div>
              <select
                className="select"
                value={app.techArchAssetId}
                onChange={(e) => handleUpdateLayerBinding({ techArchAssetId: e.target.value })}
              >
                {archAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span className="badge badge-accent">DDD Deep Modules</span>
            </div>
          </div>
        )}
      </div>

      {/* Compiled Progressive-Disclosure Development Package Inspector */}
      {compiledPkg && (
        <div
          style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: 12 }}
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge badge-ok">{activeFile?.sizeBytes} bytes</span>
                {activeFile && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      triggerBrowserDownload(
                        activeFile.relativePath.split('/').pop() || 'artifact.md',
                        activeFile.content,
                      )
                    }
                  >
                    {t('下载单文件', 'Download File')}
                  </button>
                )}
              </div>
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

      {/* In-Platform AI Coding Agent Panel */}
      {app && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <div>
              <h4 className="card-title">
                {t(
                  '平台内置 AI 研发智能体 (In-Platform Pi Coding Agent)',
                  'In-Platform AI Coding Agent',
                )}
              </h4>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {t(
                  '遵循《开发指导书.md》与《本体模型业务功能开发指导书.md》渐进式上下文执行全栈代码生成与门禁核验',
                  'Executes progressive-disclosure engineering tasks directly against the assembled 4-layer bundle',
                )}
              </div>
            </div>
            <span className="badge badge-ok">{app.status}</span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              value={codingInstruction}
              onChange={(e) => setCodingInstruction(e.target.value)}
              placeholder={t(
                '输入研发任务指令，例如：实现结算单逾期冻结命令接口与单元测试...',
                'Enter coding instruction for the AI agent...',
              )}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRunCodingAgent();
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              data-testid="run-coding-agent-btn"
              disabled={runningAgent}
              onClick={handleRunCodingAgent}
            >
              {runningAgent
                ? t('Agent 构建中...', 'Running Agent...')
                : t('启动 AI 研发构建', 'Run AI Coding Agent')}
            </button>
          </div>

          {agentReply && (
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: 'var(--accent-soft)',
                border: '1px solid var(--line)',
                borderRadius: 5,
                fontFamily: 'var(--mono)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              {agentReply}
            </pre>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              {t('实时智能体构建与流水线日志', 'Real-Time Agent Build Logs')} (
              {app.agentDevLogs.length})
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {[...app.agentDevLogs].reverse().map((log, i) => (
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
        </div>
      )}
    </div>
  );
}

// ─── 8. Skills & Application Publish Views ───────────────────────────────────
export function OntologySkillsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  if (!data) return null;

  const handleCompileCurrentSkill = async () => {
    const res = await fetch(`/api/projects/${data.activeProject.id}/generate-skill`, {
      method: 'POST',
    });
    const json = await res.json();
    patchData({ generatedSkills: json.skills });
    showToast(`已生成业务本体技能包 ${json.skill.slug}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <div>
            <h3 className="card-title">
              {t(
                '渐进式业务本体技能中心 (Progressive Disclosure Ontology Skills)',
                'Ontology Skills Hub (SKILL.md)',
              )}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '将 11 元模型编译为符合 Agent 渐进式上下文披露规范的 SKILL.md，可直接下载挂载至 Claude Code / Pi / Cursor',
                'Progressive-disclosure SKILL.md artifacts compiled from 11-model ontology suites',
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCompileCurrentSkill}
          >
            {t('编译当前工程 SKILL.md', 'Compile Current Project SKILL.md')}
          </button>
        </div>
      </div>

      {data.generatedSkills.map((sk) => (
        <div key={sk.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{sk.name}</h3>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sk.description}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-accent">{sk.slug}</span>
              <span className="badge badge-ok">v{sk.version}</span>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  triggerBrowserDownload(
                    `${sk.slug}-SKILL.md`,
                    sk.skillMarkdown,
                    'text/markdown;charset=utf-8',
                  );
                  showToast(t(`已下载 ${sk.slug}-SKILL.md`, `Downloaded ${sk.slug}-SKILL.md`));
                }}
              >
                {t('一键下载 SKILL.md', 'Download SKILL.md')}
              </button>
            </div>
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
              maxHeight: 360,
              overflowY: 'auto',
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
  const { data, patchData, showToast } = useWorkbenchStore();
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [versionInputs, setVersionInputs] = useState<Record<string, string>>({});
  const [endpointInputs, setEndpointInputs] = useState<Record<string, string>>({});

  if (!data) return null;

  const handlePublishApp = async (appId: string) => {
    if (publishingId) return;
    setPublishingId(appId);
    try {
      const customVersion = versionInputs[appId]?.trim() || undefined;
      const customEndpoint = endpointInputs[appId]?.trim() || undefined;
      const res = await fetch(`/api/applications/${appId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: customVersion,
          endpoint: customEndpoint,
        }),
      });
      const json = await res.json();
      patchData({ assembledApplications: json.assembledApplications });
      setVersionInputs((prev) => ({ ...prev, [appId]: '' }));
      showToast(
        t(
          `已完成 4A V-Model 门禁核验并发布新版本 ${json.application.publishedVersion} (${json.application.publishedEndpoint})`,
          `Passed 4A gate & published ${json.application.publishedVersion} at ${json.application.publishedEndpoint}`,
        ),
      );
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.assembledApplications.map((app) => (
        <div key={app.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card-header" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
            <div>
              <h3 className="card-title">{app.name}</h3>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                {app.publishedEndpoint || `/apps/${app.id}`} ·{' '}
                {app.packageOutputDir || `.onto-cs/packages/${app.id}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-accent">4A Gate: BA · DA · AA · TA</span>
              <span className="badge badge-ok">
                {app.status} · {app.publishedVersion || 'v1.0.0'}
              </span>
            </div>
          </div>

          {/* 4A Gate Release Controls */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 6,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <input
              className="input"
              style={{ width: 150, fontFamily: 'var(--mono)' }}
              placeholder={t('新版本号 (可选)', 'Next Version')}
              value={versionInputs[app.id] ?? ''}
              onChange={(e) =>
                setVersionInputs((prev) => ({ ...prev, [app.id]: e.target.value }))
              }
            />
            <input
              className="input"
              style={{ flex: 1, minWidth: 200, fontFamily: 'var(--mono)' }}
              placeholder={app.publishedEndpoint || `/apps/${app.id}`}
              value={endpointInputs[app.id] ?? ''}
              onChange={(e) =>
                setEndpointInputs((prev) => ({ ...prev, [app.id]: e.target.value }))
              }
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={publishingId === app.id}
              onClick={() => handlePublishApp(app.id)}
            >
              {publishingId === app.id
                ? t('正在执行 4A 核验...', 'Running 4A Gate...')
                : t('执行 4A 门禁核验并发布新版本', 'Run 4A Gate & Publish Release')}
            </button>
          </div>

          <div>
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
        </div>
      ))}
    </div>
  );
}
