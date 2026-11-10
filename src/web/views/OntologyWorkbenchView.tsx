import React, { useEffect, useState } from 'react';
import {
  MODEL_STAGE_ORDER,
  serializeModelYaml,
  type ImpactAnalysisReport,
  type ModelCode,
  type OntologySuite,
} from '../../packages/ontology-core/index.js';
import {
  apiAnalyzeImpact,
  apiRenameSymbol,
  apiRunCopilot,
  useWorkbenchStore,
} from '../api.js';
import { usePreferences } from '../i18n.js';
import { KnowledgeGraphCanvas } from './KnowledgeGraphCanvas.js';

export function OntologyWorkbenchView() {
  const { t } = usePreferences();
  const {
    data,
    selectedModel,
    setSelectedModel,
    saveSuiteWithUndo,
    undo,
    redo,
    undoStack,
    redoStack,
    patchData,
    showToast,
  } = useWorkbenchStore();

  const [activeTab, setActiveTab] = useState<'STRUCTURED' | 'GRAPH' | 'YAML'>('STRUCTURED');
  const [yamlText, setYamlText] = useState('');
  const [copilotPrompt, setCopilotPrompt] = useState('');
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      meta?: string;
    }[]
  >([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '您好！我是基于 Pi Durable 与 11 元模型架构的 AI 本体助手（已连接本地 auto/glm-5.3-flash）。您可以直接让我新增聚合根、补充跨对象业务规则、或者执行一致性诊断。',
      meta: 'Pi Durable · auto/glm-5.3-flash',
    },
  ]);

  // Cascade Rename & Impact Modal state
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [targetSymbol, setTargetSymbol] = useState('Contract');
  const [newSymbolName, setNewSymbolName] = useState('CommercialContract');
  const [impactReport, setImpactReport] = useState<ImpactAnalysisReport | null>(null);
  const [showDiagnosticsDrawer, setShowDiagnosticsDrawer] = useState(false);

  const project = data?.activeProject;

  useEffect(() => {
    if (!project) return;
    const modelData = project.suite[selectedModel];
    if (modelData) {
      setYamlText(serializeModelYaml(selectedModel, modelData as never));
    } else {
      setYamlText(`# ${selectedModel} model not yet authored\n`);
    }
  }, [project, selectedModel]);

  if (!project) return null;

  const suite = project.suite;
  const validation = project.validation;

  const getModelElementCount = (code: ModelCode): number => {
    switch (code) {
      case 'M1':
        return suite.M1?.aggregates.length ?? 0;
      case 'M2':
        return suite.M2?.behaviors.length ?? 0;
      case 'M3':
        return suite.M3?.rules.length ?? 0;
      case 'ME':
        return suite.ME?.events.length ?? 0;
      case 'M4':
        return suite.M4?.event_scenarios.length ?? 0;
      case 'M5':
        return (suite.M5?.roles.length ?? 0) + (suite.M5?.permissions.length ?? 0);
      case 'M6':
        return suite.M6?.flows.length ?? 0;
      case 'M7':
        return suite.M7?.query_reports.length ?? 0;
      case 'MU':
        return suite.MU?.screens.length ?? 0;
      case 'MM':
        return suite.MM?.mappings.length ?? 0;
      case 'MI':
        return suite.MI?.interfaces.length ?? 0;
    }
  };

  const handleSaveYaml = async () => {
    const res = await fetch(`/api/projects/${project.id}/models/${selectedModel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yamlText }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(`YAML 校验失败: ${json.error}`);
      return;
    }
    patchData({ activeProject: json.project });
    showToast(`${selectedModel} YAML 元文件已保存并通过语法与两级一致性校验`);
  };

  const handleQuickAddItem = async () => {
    const next: OntologySuite = JSON.parse(JSON.stringify(suite));
    if (selectedModel === 'M1') {
      const idx = (next.M1?.aggregates.length ?? 0) + 1;
      next.M1?.aggregates.push({
        id: `AGG-0${idx}`,
        name: `DomainEntity${idx}`,
        alias: `新增领域聚合${idx}`,
        aggregateType: 'AGGREGATE_ROOT',
        description: '通过结构化工作台新增的聚合根',
        lifecycle: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
        tags: ['CUSTOM'],
        attributes: [
          {
            name: 'code',
            label: '业务编码',
            type: 'String',
            required: true,
          },
        ],
        entities: [],
        valueObjects: [],
        invariants: [],
      });
      await saveSuiteWithUndo(next, `Added aggregate AGG-0${idx}`);
      showToast(`已在 M1 新增聚合根 AGG-0${idx}`);
    } else if (selectedModel === 'M3') {
      const idx = (next.M3?.rules.length ?? 0) + 1;
      next.M3?.rules.push({
        id: `RULE-0${idx}`,
        name: `CustomValidationRule${idx}`,
        alias: `新增业务校验规则${idx}`,
        ruleType: 'VALIDATION',
        scope: 'CROSS_OBJECT',
        version: '1.0',
        referencedObjects: [next.M1?.aggregates[0]?.name ?? 'Contract'],
        parameters: [],
        expression: 'Contract.totalAmount > 0',
        violationMessage: '合同金额必须大于0',
        triggeredByEvents: [],
        producedEvents: [],
        triggeredBehaviors: [],
      });
      await saveSuiteWithUndo(next, `Added rule RULE-0${idx}`);
      showToast(`已在 M3 新增业务规则 RULE-0${idx}`);
    } else {
      setActiveTab('YAML');
    }
  };

  const handleOpenImpactModal = async (symbol = 'Contract') => {
    setTargetSymbol(symbol);
    setNewSymbolName(`${symbol}V2`);
    setRenameModalOpen(true);
    const report = await apiAnalyzeImpact(project.id, symbol);
    setImpactReport(report);
  };

  const handleExecuteCascadeRename = async () => {
    if (!targetSymbol.trim() || !newSymbolName.trim()) return;
    const result = await apiRenameSymbol(project.id, targetSymbol.trim(), newSymbolName.trim());
    patchData({ activeProject: result.project });
    setRenameModalOpen(false);
    showToast(
      `已完成级联重命名 ${targetSymbol} -> ${newSymbolName}（自动同步 ${result.changedCount} 处跨模型引用）`,
    );
  };

  const handleSendCopilot = async (textOverride?: string) => {
    const promptText = (textOverride ?? copilotPrompt).trim();
    if (!promptText || copilotBusy) return;
    setCopilotPrompt('');
    setCopilotBusy(true);
    setCopilotMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: promptText },
    ]);

    try {
      const res = await apiRunCopilot(project.id, promptText, selectedModel);
      patchData({ activeProject: res.project });
      setCopilotMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.reply,
          meta: `${res.modelUsed} · ${res.latencyMs}ms${res.toolCalls.length > 0 ? ` · 执行工具: ${res.toolCalls.map((tc) => tc.toolName).join(', ')}` : ''}`,
        },
      ]);
    } finally {
      setCopilotBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <div className="ontology-workbench">
        {/* ─── Left Pane: 11-Model Progressive Navigator ─── */}
        <div className="workbench-left">
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 12 }}>
              {t('11 元模型渐进导航', '11-Model Stages')}
            </span>
            <span className="badge badge-accent">{validation.presentModels.length}/11</span>
          </div>

          <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {MODEL_STAGE_ORDER.map((item) => {
              const isSelected = selectedModel === item.code;
              const isPresent = Boolean(suite[item.code]);
              const modelErrors = validation.diagnostics.filter(
                (d) => d.model === item.code && d.tier === 'ERROR',
              ).length;
              const cnt = getModelElementCount(item.code);

              return (
                <button
                  key={item.code}
                  type="button"
                  data-testid={`model-nav-${item.code}`}
                  className={`nav-item ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedModel(item.code)}
                >
                  <span className="nav-item-left">
                    <span
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        fontWeight: 600,
                        minWidth: 26,
                      }}
                    >
                      {item.code}
                    </span>
                    <span>{t(item.labelZh.slice(3), item.labelEn.slice(3))}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {modelErrors > 0 ? (
                      <span className="badge badge-bad">{modelErrors}</span>
                    ) : isPresent ? (
                      <span className="badge badge-ok">{cnt}</span>
                    ) : (
                      <span className="badge badge-warn">待建</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Center Pane: 3-Tab Model Editor ─── */}
        <div className="workbench-center">
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              background: 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-accent">{selectedModel}</span>
              <strong style={{ fontFamily: 'var(--serif)', fontSize: 14.5 }}>
                {
                  MODEL_STAGE_ORDER.find((m) => m.code === selectedModel)?.[
                    t('labelZh', 'labelEn') as 'labelZh' | 'labelEn'
                  ]
                }
              </strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className={`btn btn-sm ${activeTab === 'STRUCTURED' ? 'btn-primary' : ''}`}
                onClick={() => setActiveTab('STRUCTURED')}
              >
                {t('结构化视图', 'Structured')}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activeTab === 'GRAPH' ? 'btn-primary' : ''}`}
                onClick={() => setActiveTab('GRAPH')}
              >
                {t('模型关系图', 'Graph')}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activeTab === 'YAML' ? 'btn-primary' : ''}`}
                onClick={() => setActiveTab('YAML')}
              >
                {t('YAML 元文件', 'YAML Source')}
              </button>

              <span style={{ width: 1, height: 18, background: 'var(--line)' }} />

              <button
                type="button"
                className="btn btn-sm"
                disabled={undoStack.length === 0}
                onClick={() => undo()}
                title="Undo"
              >
                ↶ {t('撤销', 'Undo')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={redoStack.length === 0}
                onClick={() => redo()}
                title="Redo"
              >
                ↷ {t('重做', 'Redo')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="open-cascade-rename-btn"
                onClick={() => handleOpenImpactModal('Contract')}
              >
                {t('级联重命名 / 影响分析', 'Cascade Rename')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={handleQuickAddItem}
              >
                + {t('新增模型项', 'Add Item')}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            {activeTab === 'GRAPH' && (
              <KnowledgeGraphCanvas graph={project.knowledgeGraph} height={470} />
            )}

            {activeTab === 'YAML' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                    .onto-cs/model/{project.id}/yaml/{selectedModel.toLowerCase()}.yaml
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={handleSaveYaml}
                  >
                    {t('保存并校验 YAML', 'Save & Validate YAML')}
                  </button>
                </div>
                <textarea
                  className="textarea mono"
                  style={{ flex: 1, minHeight: 440 }}
                  value={yamlText}
                  onChange={(e) => setYamlText(e.target.value)}
                />
              </div>
            )}

            {activeTab === 'STRUCTURED' && (
              <StructuredModelInspector
                modelCode={selectedModel}
                suite={suite}
                onInspectImpact={handleOpenImpactModal}
              />
            )}
          </div>
        </div>

        {/* ─── Right Pane: AI Ontology Copilot (Pi Durable · auto/glm-5.3-flash) ─── */}
        <div className="workbench-right">
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>
              {t('AI 本体助手 (Pi Durable)', 'AI Ontology Copilot')}
            </span>
            <span className="badge badge-ok">glm-5.3-flash</span>
          </div>

          <div
            style={{
              padding: '8px 10px',
              borderBottom: '1px solid var(--line-2)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 5,
            }}
          >
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleSendCopilot('新增一条超期未结算自动预警规则')}
            >
              + {t('生成M3预警规则', 'Add M3 Rule')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleSendCopilot('新增合同补充协议聚合根')}
            >
              + {t('生成M1补充协议聚合', 'Add M1 Aggregate')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleSendCopilot('诊断当前11个模型的跨模型引用完整性')}
            >
              {t('诊断11模型完整性', 'Diagnose 11 Models')}
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {copilotMessages.map((m) => (
              <div
                key={m.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: m.role === 'user' ? 'var(--accent-soft)' : 'var(--surface)',
                  border: '1px solid var(--line)',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                }}
              >
                <div
                  style={{
                    fontSize: 10.5,
                    color: 'var(--muted)',
                    marginBottom: 4,
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {m.role === 'user' ? t('您', 'You') : m.meta || 'AI Copilot'}
                </div>
                <div>{m.content}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              padding: 10,
              borderTop: '1px solid var(--line)',
              display: 'flex',
              gap: 6,
            }}
          >
            <input
              className="input"
              data-testid="copilot-input"
              placeholder={t('输入自然语言指令修改或诊断本体...', 'Ask Copilot to mutate or verify ontology...')}
              value={copilotPrompt}
              onChange={(e) => setCopilotPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendCopilot();
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              data-testid="copilot-send-btn"
              disabled={copilotBusy}
              onClick={() => handleSendCopilot()}
            >
              {copilotBusy ? '...' : t('发送', 'Send')}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Bottom Two-Tier Validation Status Bar ─── */}
      <div className="workbench-statusbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className={`badge ${validation.errorCount === 0 ? 'badge-ok' : 'badge-bad'}`}
            data-testid="validation-error-badge"
          >
            {validation.errorCount === 0
              ? t('✓ 一致性校验通过 (0 Errors)', '✓ Consistency Gate Passed (0 Errors)')
              : `${validation.errorCount} Consistency Errors`}
          </span>
          <span className="badge badge-warn" data-testid="validation-warning-badge">
            {validation.warningCount} {t('阶段提示 (Stage Warnings)', 'Stage Warnings')}
          </span>
          <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {t('已就绪模型', 'Models Ready')}: {validation.presentModels.join(' · ')}
          </span>
        </div>

        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setShowDiagnosticsDrawer((v) => !v)}
        >
          {showDiagnosticsDrawer
            ? t('收起校验详情', 'Hide Diagnostics')
            : t(`查看校验明细 (${validation.diagnostics.length})`, `Diagnostics (${validation.diagnostics.length})`)}
        </button>
      </div>

      {showDiagnosticsDrawer && (
        <div
          style={{
            position: 'fixed',
            bottom: 34,
            left: 224,
            right: 0,
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--surface)',
            borderTop: '1px solid var(--line)',
            padding: 12,
            zIndex: 900,
          }}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('级别', 'Tier')}</th>
                <th>{t('模型', 'Model')}</th>
                <th>{t('编码', 'Code')}</th>
                <th>{t('诊断说明', 'Message')}</th>
              </tr>
            </thead>
            <tbody>
              {validation.diagnostics.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--ok)' }}>
                    {t('全套 11 个模型全部就绪且无任何跨模型引用错误。', 'All 11 models are authored with zero cross-model consistency errors.')}
                  </td>
                </tr>
              ) : (
                validation.diagnostics.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className={`badge ${d.tier === 'ERROR' ? 'badge-bad' : 'badge-warn'}`}>
                        {d.tier}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{d.model}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{d.code}</td>
                    <td>{t(d.messageZh, d.messageEn)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Non-Blocking Cascade Rename & Impact Analysis Modal ─── */}
      {renameModalOpen && (
        <div className="modal-backdrop" onClick={() => setRenameModalOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">
                {t('跨模型影响分析与级联重命名 (M1~MI)', 'Cross-Model Impact Analysis & Cascade Rename')}
              </h3>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setRenameModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr auto',
                gap: 8,
                marginBottom: 12,
                alignItems: 'end',
              }}
            >
              <div>
                <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {t('原本体符号 / ID', 'Original Symbol / ID')}
                </label>
                <input
                  className="input"
                  value={targetSymbol}
                  onChange={(e) => setTargetSymbol(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {t('新本体符号 / ID', 'New Symbol / ID')}
                </label>
                <input
                  className="input"
                  data-testid="cascade-rename-new-input"
                  value={newSymbolName}
                  onChange={(e) => setNewSymbolName(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const rep = await apiAnalyzeImpact(project.id, targetSymbol);
                  setImpactReport(rep);
                }}
              >
                {t('重新扫描引用', 'Scan Impact')}
              </button>
            </div>

            {impactReport && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ marginBottom: 8, fontSize: 12 }}>
                  {t('扫描到跨模型引用数', 'Cross-Model References Found')}:{' '}
                  <strong style={{ fontFamily: 'var(--mono)' }}>
                    {impactReport.references.length}
                  </strong>{' '}
                  ({t('直接删除安全性', 'Safe to delete directly')}:{' '}
                  <span
                    className={`badge ${impactReport.canDeleteSafely ? 'badge-ok' : 'badge-warn'}`}
                  >
                    {impactReport.canDeleteSafely ? 'SAFE' : 'REFERENCED'}
                  </span>
                  )
                </div>
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: 'auto',
                    border: '1px solid var(--line)',
                    borderRadius: 5,
                  }}
                >
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('模型', 'Model')}</th>
                        <th>{t('引用元素', 'Element')}</th>
                        <th>{t('路径说明', 'Description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impactReport.references.map((ref, idx) => (
                        <tr key={`${ref.model}-${ref.elementId}-${idx}`}>
                          <td>
                            <span className="badge badge-accent">{ref.model}</span>
                          </td>
                          <td style={{ fontFamily: 'var(--mono)' }}>{ref.elementId}</td>
                          <td>{t(ref.descriptionZh, ref.descriptionEn)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setRenameModalOpen(false)}
              >
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="confirm-cascade-rename-btn"
                onClick={handleExecuteCascadeRename}
              >
                {t('执行 11 模型原子级联重命名', 'Execute Atomic Cascade Rename')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StructuredModelInspector({
  modelCode,
  suite,
  onInspectImpact,
}: {
  modelCode: ModelCode;
  suite: OntologySuite;
  onInspectImpact: (symbol: string) => void;
}) {
  const { t } = usePreferences();

  switch (modelCode) {
    case 'M1': {
      const m1 = suite.M1;
      if (!m1) return <div>M1 未创建</div>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {m1.aggregates.map((agg) => (
            <div key={agg.id} className="card">
              <div className="card-header">
                <div>
                  <span className="badge badge-accent" style={{ marginRight: 8 }}>
                    {agg.id}
                  </span>
                  <strong style={{ fontSize: 14.5 }}>
                    {agg.name} ({agg.alias})
                  </strong>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className="badge badge-ok">
                    {t('生命周期', 'Lifecycle')}: {agg.lifecycle.join(' → ')}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onInspectImpact(agg.name)}
                  >
                    {t('分析引用影响', 'Impact Analysis')}
                  </button>
                </div>
              </div>
              <p style={{ margin: '0 0 10px 0', color: 'var(--muted)' }}>{agg.description}</p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('属性名', 'Attribute')}</th>
                    <th>{t('中文名', 'Label')}</th>
                    <th>{t('类型', 'Type')}</th>
                    <th>{t('必填', 'Req')}</th>
                    <th>{t('引用/约束规则', 'Ref & Rules')}</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.attributes.map((attr) => (
                    <tr key={attr.name}>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{attr.name}</td>
                      <td>{attr.label}</td>
                      <td>
                        <span className="badge badge-accent">{attr.type}</span>
                      </td>
                      <td>{attr.required ? 'Yes' : 'No'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                        {attr.targetAggregate && `→ ${attr.targetAggregate} `}
                        {attr.dictionaryRef &&
                          `Dict:${attr.dictionaryRef.dictionaryId}.${attr.dictionaryRef.typeCode} `}
                        {(attr.refRules ?? []).map((r) => `${r.name}: ${r.expression}`).join('; ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {agg.invariants.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  <strong>{t('聚合不变量 (Invariants)', 'Invariants')}: </strong>
                  {agg.invariants.map((inv) => (
                    <span
                      key={inv.name}
                      className="badge badge-warn"
                      style={{ marginRight: 6 }}
                    >
                      {inv.name}: {inv.expression}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'M2': {
      const m2 = suite.M2;
      if (!m2) return <div>M2 未创建</div>;
      return (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('行为名称', 'Behavior')}</th>
                <th>{t('归属对象', 'Owner')}</th>
                <th>{t('分类 / 触发', 'Type / Trigger')}</th>
                <th>{t('调用规则 (M3)', 'Rules')}</th>
                <th>{t('产生事件 / 报表', 'Events / Report')}</th>
              </tr>
            </thead>
            <tbody>
              {m2.behaviors.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{b.id}</td>
                  <td>
                    <strong>{b.alias}</strong>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                      {b.name}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{b.ownerEntity}</td>
                  <td>
                    <span className="badge badge-accent">{b.behaviorType}</span>{' '}
                    <span className="badge">{b.triggerType}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{b.invokedRules.join(', ') || '-'}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>
                    {b.producedEvents.map((e) => (typeof e === 'string' ? e : e.eventRef)).join(', ') ||
                      b.queryReportRef ||
                      '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'M3': {
      const m3 = suite.M3;
      if (!m3) return <div>M3 未创建</div>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {m3.rules.map((r) => (
            <div key={r.id} className="card">
              <div className="card-header">
                <div>
                  <span className="badge badge-accent" style={{ marginRight: 8 }}>
                    {r.id}
                  </span>
                  <strong>
                    {r.alias} ({r.name})
                  </strong>
                </div>
                <span className="badge badge-warn">{r.ruleType}</span>
              </div>
              <p style={{ margin: '0 0 8px 0', color: 'var(--muted)' }}>{r.description}</p>
              <div
                style={{
                  padding: '8px 10px',
                  background: 'var(--surface-2)',
                  borderRadius: 4,
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                }}
              >
                {r.expression}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--bad)' }}>
                {t('违背提示', 'Violation')}: {r.violationMessage}
              </div>
            </div>
          ))}
        </div>
      );
    }

    case 'ME': {
      const me = suite.ME;
      if (!me) return <div>ME 未创建</div>;
      return (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('事件名称 (<对象>.<过去分词>)', 'Event Name')}</th>
                <th>{t('中文名', 'Label')}</th>
                <th>{t('生产者行为', 'Producer')}</th>
                <th>{t('源聚合根', 'Aggregate')}</th>
                <th>{t('订阅方', 'Subscribers')}</th>
              </tr>
            </thead>
            <tbody>
              {me.events.map((ev) => (
                <tr key={ev.id}>
                  <td style={{ fontFamily: 'var(--mono)' }}>{ev.id}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{ev.name}</td>
                  <td>{ev.label}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{ev.producerBehaviorRef}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{ev.sourceAggregate}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>
                    {ev.subscribers.map((s) => `${s.subscriberType}:${s.subscriberRef}`).join(', ') ||
                      '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'M4': {
      const m4 = suite.M4;
      if (!m4) return <div>M4 未创建</div>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {m4.event_scenarios.map((sc) => (
            <div key={sc.id} className="card">
              <div className="card-header">
                <strong>
                  {sc.id} · {sc.name}
                </strong>
                <span className="badge badge-accent">Trigger: {sc.triggerEventRef}</span>
              </div>
              <p style={{ margin: '0 0 10px 0', color: 'var(--muted)' }}>{sc.description}</p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Type</th>
                    <th>Ref ID</th>
                    <th>Aggregate</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {sc.steps.map((st) => (
                    <tr key={st.stepOrder}>
                      <td style={{ fontFamily: 'var(--mono)' }}>#{st.stepOrder}</td>
                      <td>
                        <span className="badge badge-accent">{st.stepType}</span>
                      </td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{st.refId}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{st.targetAggregate}</td>
                      <td>{st.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    }

    case 'M5': {
      const m5 = suite.M5;
      if (!m5) return <div>M5 未创建</div>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <h4 className="card-title" style={{ marginBottom: 8 }}>
              {t('角色定义 (Roles)', 'Roles')}
            </h4>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>{t('角色名称', 'Name')}</th>
                  <th>Code</th>
                  <th>{t('数据范围', 'Scope')}</th>
                  <th>{t('拥有权限', 'Permissions')}</th>
                </tr>
              </thead>
              <tbody>
                {m5.roles.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'var(--mono)' }}>{r.id}</td>
                    <td>{r.name}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{r.code}</td>
                    <td>
                      <span className="badge badge-ok">{r.dataScope}</span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{r.permissions.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h4 className="card-title" style={{ marginBottom: 8 }}>
              {t('权限矩阵 (Permissions)', 'Permissions')}
            </h4>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>{t('权限名称', 'Name')}</th>
                  <th>{t('受控聚合根', 'Target Aggregate')}</th>
                  <th>{t('允许行为 (M2)', 'Allowed Behaviors')}</th>
                </tr>
              </thead>
              <tbody>
                {m5.permissions.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontFamily: 'var(--mono)' }}>{p.id}</td>
                    <td>{p.name}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{p.targetAggregate}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{p.allowedBehaviors.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    case 'M6': {
      const m6 = suite.M6;
      if (!m6) return <div>M6 未创建</div>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {m6.flows.map((fl) => (
            <div key={fl.id} className="card">
              <div className="card-header">
                <strong>
                  {fl.id} · {fl.name}
                </strong>
                <span className="badge badge-accent">{fl.flowType}</span>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Activity ID</th>
                    <th>{t('节点名称', 'Name')}</th>
                    <th>{t('节点类型', 'Type')}</th>
                    <th>{t('绑定角色/行为/场景', 'Bindings')}</th>
                    <th>{t('流转目标 / 分支', 'Next / Branches')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fl.activities.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontFamily: 'var(--mono)' }}>{a.id}</td>
                      <td>{a.name}</td>
                      <td>
                        <span className="badge badge-accent">{a.activityType}</span>
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                        {[a.roleRef, a.behaviorRef, a.scenarioRef, a.screenRef]
                          .filter(Boolean)
                          .join(' · ') || '-'}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                        {a.nextActivity ||
                          a.branches.map((b) => `${b.label || b.condition} -> ${b.targetActivity}`).join(' | ') ||
                          '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    }

    case 'M7': {
      const m7 = suite.M7;
      if (!m7) return <div>M7 未创建</div>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {m7.query_reports.map((qr) => (
            <div key={qr.id} className="card">
              <div className="card-header">
                <div>
                  <span className="badge badge-accent" style={{ marginRight: 8 }}>
                    {qr.id}
                  </span>
                  <strong>
                    {qr.alias} ({qr.name})
                  </strong>
                </div>
                <span className="badge badge-ok">1:1 M2 Behavior: {qr.behaviorRef}</span>
              </div>
              <p style={{ margin: '0 0 8px 0', color: 'var(--muted)' }}>{qr.description}</p>
              <div
                style={{
                  padding: 10,
                  background: 'var(--surface-2)',
                  borderRadius: 5,
                  fontFamily: 'var(--mono)',
                  fontSize: 11.5,
                  overflowX: 'auto',
                }}
              >
                {qr.referenceSql.sql}
              </div>
            </div>
          ))}
        </div>
      );
    }

    case 'MU': {
      const mu = suite.MU;
      if (!mu) return <div>MU 未创建</div>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mu.screens.map((sc) => (
            <div key={sc.screenId} className="card">
              <div className="card-header">
                <strong>
                  {sc.screenId} · {sc.name}
                </strong>
                <span className="badge badge-accent">
                  {sc.screenType} · {sc.route}
                </span>
              </div>
              {sc.layout && (
                <pre
                  style={{
                    margin: '0 0 10px 0',
                    padding: 10,
                    background: 'var(--surface-2)',
                    borderRadius: 5,
                    fontFamily: 'var(--mono)',
                    fontSize: 11.5,
                    overflowX: 'auto',
                  }}
                >
                  {sc.layout}
                </pre>
              )}
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                {t('UI 事件调用链 (VALIDATE → BEHAVIOR → EVENT)', 'UI Event Call Chains')}
              </div>
              {sc.events.map((ev) => (
                <div
                  key={ev.eventId}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--surface-2)',
                    borderRadius: 4,
                    marginBottom: 6,
                    fontFamily: 'var(--mono)',
                    fontSize: 11.5,
                  }}
                >
                  <strong>{ev.eventId}</strong> ({ev.name}) [{ev.triggerElementId}]:{' '}
                  {ev.callChain.map((s) => `${s.stepOrder}.${s.stepType}(${s.refId})`).join(' → ')}
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }

    case 'MM': {
      const mm = suite.MM;
      if (!mm) return <div>MM 未创建</div>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mm.mappings.map((mp) => (
            <div key={mp.id} className="card">
              <div className="card-header">
                <strong>
                  {mp.id} · {mp.objectName} ({mp.objectRef})
                </strong>
                <span className="badge badge-ok">
                  {mp.tableMappings.map((t) => t.tableName).join(', ')}
                </span>
              </div>
              {mp.tableMappings.map((tm) => (
                <table key={tm.tableName} className="data-table">
                  <thead>
                    <tr>
                      <th>{t('对象属性', 'Attribute Ref')}</th>
                      <th>{t('物理表字段', 'Column')}</th>
                      <th>{t('字段类型', 'Column Type')}</th>
                      <th>{t('外键/值对象策略', 'FK / Strategy')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tm.columnMappings.map((cm) => (
                      <tr key={cm.column}>
                        <td style={{ fontFamily: 'var(--mono)' }}>{cm.attributeRef}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{cm.column}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{cm.columnType}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>
                          {cm.fkTargetTable ? `FK -> ${cm.fkTargetTable}.${cm.fkTargetColumn}` : cm.valueObjectStrategy || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          ))}
        </div>
      );
    }

    case 'MI': {
      const mi = suite.MI;
      if (!mi) return <div>MI 未创建</div>;
      return (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('接口名称', 'Interface Name')}</th>
                <th>{t('方向 / 分类', 'Direction / Category')}</th>
                <th>{t('协议', 'Protocol')}</th>
                <th>{t('关联行为 / 报表 / 外部主体', 'Linked Element')}</th>
              </tr>
            </thead>
            <tbody>
              {mi.interfaces.map((intf) => (
                <tr key={intf.interfaceId}>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{intf.interfaceId}</td>
                  <td>{intf.name}</td>
                  <td>
                    <span className="badge badge-accent">{intf.direction}</span>{' '}
                    <span className="badge">{intf.interfaceCategory}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{intf.protocol}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>
                    {[
                      intf.relatedBehaviorRef,
                      intf.relatedReportRef,
                      intf.relatedExternalEntityRef,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
}

