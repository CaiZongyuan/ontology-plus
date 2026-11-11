import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Edit3,
  Eye,
  FileCode,
  FolderKanban,
  History,
  LayoutList,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  MODEL_CODES,
  MODEL_FILE_NAMES,
  MODEL_STAGE_ORDER,
  serializeManifestJson,
  serializeSuiteToYamlFiles,
  type ModelCode,
} from '../../packages/ontology-core/index.js';
import type { CompiledDevelopmentPackage } from '../../packages/package-compiler/index.js';
import type {
  AssembledApplication,
  FourLayerAsset,
  GeneratedSkill,
  ProjectSnapshot,
  ProjectSummary,
  PrototypeArtifact,
  RequirementDoc,
} from '../../packages/workspace-store/index.js';
import {
  apiCloneProject,
  apiCompileDevPackage,
  apiCreateProjectSnapshot,
  apiDeleteProject,
  apiDeleteProjectSnapshot,
  apiDeleteResource,
  apiGeneratePrototype,
  apiGenerateTechArch,
  apiPostJson,
  apiPutJson,
  apiRefinePrototype,
  apiRestoreProjectSnapshot,
  apiSynthesizeOntologyFromPrototype,
  apiSynthesizeSrsDoc,
  apiUpdateProjectMeta,
  triggerBrowserDownload,
  useWorkbenchStore,
} from '../api.js';
import { AgentSessionWorkbench } from '../components/agent/AgentSessionWorkbench.js';
import {
  Button,
  CodeBlock,
  ConfirmDialog,
  RegistryTable,
} from '../components/beautifui/index.js';
import {
  MarkdownRenderer,
  TiptapMarkdownEditor,
} from '../components/markdown/index.js';
import { usePreferences, type NavViewId } from '../i18n.js';
import { cn } from '../lib/utils.js';

// ─── Reusable Two-Level Workspace ↔ Registry Switcher Bar ───────────────────
function ViewModeHeader({
  mode,
  onChange,
  workspaceLabel,
  registryLabel,
  count,
  testIdPrefix,
  rightActions,
}: {
  mode: 'WORKSPACE' | 'REGISTRY';
  onChange: (next: 'WORKSPACE' | 'REGISTRY') => void;
  workspaceLabel: string;
  registryLabel: string;
  count: number;
  testIdPrefix: string;
  rightActions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-window border border-line bg-surface px-3.5 py-2 shadow-2xs">
      <div className="inline-flex items-center rounded-[7px] border border-line bg-inset p-0.5">
        <button
          type="button"
          data-testid={`${testIdPrefix}-mode-workspace`}
          onClick={() => onChange('WORKSPACE')}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium cursor-pointer transition-colors',
            mode === 'WORKSPACE' ? 'bg-surface text-ink shadow-hairline' : 'text-ink-2 hover:text-ink',
          )}
        >
          <Edit3 size={12.5} />
          {workspaceLabel}
        </button>
        <button
          type="button"
          data-testid={`${testIdPrefix}-mode-registry`}
          onClick={() => onChange('REGISTRY')}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium cursor-pointer transition-colors',
            mode === 'REGISTRY' ? 'bg-surface text-ink shadow-hairline' : 'text-ink-2 hover:text-ink',
          )}
        >
          <LayoutList size={12.5} />
          {registryLabel}
          <span
            className={cn(
              'rounded-full px-1.5 font-mono text-[10.5px] tabular-nums',
              mode === 'REGISTRY' ? 'bg-white/20 text-surface' : 'bg-surface text-ink-3',
            )}
          >
            {count}
          </span>
        </button>
      </div>
      {rightActions && <div className="flex flex-wrap items-center gap-2">{rightActions}</div>}
    </div>
  );
}

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

// ─── 1. Overview / Ontology Project Management Hub (本体工程管理中心) ─────────
export function OverviewSessionsView({
  onNavigate,
}: {
  onNavigate: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { data, switchProject, createNewProject, patchData, showToast, bootstrap } =
    useWorkbenchStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newCenter, setNewCenter] = useState<'APPLICATION' | 'CAPABILITY' | 'ANALYTICS'>(
    'APPLICATION',
  );
  const [newDescription, setNewDescription] = useState('');
  const [newTemplate, setNewTemplate] = useState<'CONTRACT' | 'MFT' | 'EMPTY'>('CONTRACT');

  // Edit Metadata Dialog State
  const [editingProj, setEditingProj] = useState<ProjectSummary | null>(null);

  // Snapshots Drawer/Dialog State
  const [snapshotProj, setSnapshotProj] = useState<ProjectSummary | null>(null);
  const [snapLabel, setSnapLabel] = useState('');
  const [snapNote, setSnapNote] = useState('');

  // Delete Project Dialog State
  const [deletingProj, setDeletingProj] = useState<{
    proj: ProjectSummary;
    needsForce: boolean;
    conflictMsg?: string;
  } | null>(null);

  if (!data) return null;
  const active = data.activeProject;
  const snapshotsForModal: ProjectSnapshot[] = snapshotProj
    ? (data.projectSnapshots ?? []).filter((s) => s.projectId === snapshotProj.id)
    : [];

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

  const handleCloneProject = async (proj: ProjectSummary) => {
    const res = await apiCloneProject(proj.id);
    patchData({ projects: res.projects, activeProject: res.project });
    showToast(t(`已克隆工程「${res.project.name}」`, `Cloned project "${res.project.name}"`));
  };

  const handleSaveEditedProject = async () => {
    if (!editingProj) return;
    const res = await apiUpdateProjectMeta(editingProj.id, {
      name: editingProj.name,
      code: editingProj.code,
      domain: editingProj.domain,
      center: editingProj.center,
      description: editingProj.description,
    });
    patchData({
      projects: res.projects,
      ...(active.id === editingProj.id ? { activeProject: res.project } : {}),
    });
    setEditingProj(null);
    showToast(t('已更新本体工程元数据', 'Updated project metadata'));
  };

  const handleDeleteProjectConfirm = async () => {
    if (!deletingProj) return;
    try {
      const res = await apiDeleteProject(deletingProj.proj.id, deletingProj.needsForce);
      await bootstrap(res.remainingProjectId);
      setDeletingProj(null);
      showToast(
        t(
          `已删除本体工程「${deletingProj.proj.name}」`,
          `Deleted project "${deletingProj.proj.name}"`,
        ),
      );
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 409 && !deletingProj.needsForce) {
        setDeletingProj({
          proj: deletingProj.proj,
          needsForce: true,
          conflictMsg: e.message,
        });
      } else {
        showToast(e.message);
        setDeletingProj(null);
      }
    }
  };

  const handleCreateSnapshot = async () => {
    if (!snapshotProj) return;
    const label =
      snapLabel.trim() ||
      `v${snapshotsForModal.length + 1}.0 快照 (${new Date().toISOString().slice(0, 10)})`;
    const res = await apiCreateProjectSnapshot(snapshotProj.id, {
      label,
      note: snapNote.trim() || '手工保存 11 模型里程碑快照',
    });
    const otherSnaps = (data.projectSnapshots ?? []).filter(
      (s) => s.projectId !== snapshotProj.id,
    );
    patchData({ projectSnapshots: [...res.snapshots, ...otherSnaps] });
    setSnapLabel('');
    setSnapNote('');
    showToast(t(`已创建工程快照「${label}」`, `Created snapshot "${label}"`));
  };

  const handleRestoreSnapshot = async (snap: ProjectSnapshot) => {
    if (!snapshotProj) return;
    const res = await apiRestoreProjectSnapshot(snapshotProj.id, snap.id);
    const otherSnaps = (data.projectSnapshots ?? []).filter(
      (s) => s.projectId !== snapshotProj.id,
    );
    patchData({
      projects: res.projects,
      ...(active.id === snapshotProj.id ? { activeProject: res.project } : {}),
      projectSnapshots: [...res.snapshots, ...otherSnaps],
    });
    showToast(t(`已恢复至快照「${snap.label}」`, `Restored snapshot "${snap.label}"`));
  };

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
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={() => onNavigate('app-assembly-dev')}
            >
              {t('进入四层装配与开发包编译 →', 'Open 4-Layer Assembly →')}
            </Button>
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {t('活跃智能体推理网关', 'Active Agent LLM Gateway')}
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 600, marginTop: 4 }}>
            {data.systemSettings.mockLlmMode
              ? 'Mock Demo Engine'
              : ((data.llmProviders.find((p) => p.enabled) ?? data.llmProviders[0])
                  ?.defaultModel ?? 'auto/glm-5.3-flash')}
          </div>
          <div style={{ marginTop: 6 }}>
            <span className="badge badge-ok">
              {(data.agentSessions ?? []).length} {t('条智能体会话', 'Agent Sessions')}
            </span>{' '}
            <span className="badge badge-accent">
              {(data.llmProviders.find((p) => p.enabled) ?? data.llmProviders[0])?.name ??
                'Pi Durable'}
            </span>
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
                <Button
                  type="button"
                  variant="accent" size="sm"
                  onClick={() => onNavigate(st.targetView)}
                >
                  {t('进入', 'Open')} →
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ontology Project Management Hub Registry Table */}
      <RegistryTable<ProjectSummary>
        testId="project-hub-registry"
        title={t('本体工程管理中心 (Ontology Project Hub)', 'Ontology Project Management Hub')}
        subtitle={t(
          '管理所有业务本体工程的元数据、克隆副本、11 模型历史版本快照与生命周期（与单轮智能体会话严格解耦）',
          'Full lifecycle management for Ontology Projects: metadata, cloning, snapshots, and safe deletion',
        )}
        rows={data.projects}
        getRowKey={(p) => p.id}
        activeRowKey={active.id}
        searchPlaceholder={t('按工程编码、名称或业务领域搜索…', 'Search by code, name, or domain…')}
        matchesSearch={(p, q) =>
          p.code.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.domain.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
        }
        statusFilters={[
          { value: 'ALL', label: t('全部中心', 'All') },
          { value: 'APPLICATION', label: 'APPLICATION' },
          { value: 'CAPABILITY', label: 'CAPABILITY' },
          { value: 'ANALYTICS', label: 'ANALYTICS' },
        ]}
        getRowStatus={(p) => p.center}
        primaryActionLabel={t('新建本体工程', 'New Ontology Project')}
        primaryActionTestId="new-project-hub-btn"
        onPrimaryAction={() => setCreateOpen(true)}
        columns={[
          {
            key: 'code',
            header: t('工程编码', 'Code'),
            width: '130px',
            render: (p) => (
              <span className="font-mono text-[12px] font-semibold text-ink">{p.code}</span>
            ),
          },
          {
            key: 'name',
            header: t('工程名称与说明', 'Project Name'),
            render: (p) => (
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-ink">
                  <FolderKanban size={13.5} className="text-accent" />
                  <span>{p.name}</span>
                  {p.id === active.id && (
                    <span className="filter-status-done rounded-full px-2 py-0.2 text-[10px] font-semibold">
                      {t('当前激活', 'Active')}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11.5px] text-ink-3">{p.description}</div>
              </div>
            ),
          },
          {
            key: 'domain',
            header: t('业务领域 / 中心', 'Domain / Center'),
            width: '180px',
            render: (p) => (
              <div className="space-y-1">
                <div className="text-[12px] text-ink">{p.domain}</div>
                <span className="filter-status-accent inline-block rounded-full px-2 py-0.2 font-mono text-[10px]">
                  {p.center}
                </span>
              </div>
            ),
          },
          {
            key: 'stage',
            header: t('11 模型进度', 'Stage Progress'),
            width: '130px',
            render: (p) => (
              <span className="filter-status-done inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px]">
                {p.currentStage} / 11 Models
              </span>
            ),
          },
          {
            key: 'actions',
            header: t('管理操作', 'Actions'),
            align: 'right',
            render: (p) => (
              <div
                className="inline-flex flex-wrap items-center justify-end gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant={p.id === active.id ? 'primary' : 'secondary'}
                  size="xs"
                  onClick={async () => {
                    if (p.id !== active.id) await switchProject(p.id);
                    onNavigate('app-ontology');
                  }}
                >
                  {t('打开建模台', 'Workbench')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setSnapshotProj(p)}
                  data-testid={`project-snapshots-btn-${p.id}`}
                  title={t('版本快照管理', 'Manage Snapshots')}
                >
                  <History size={12} />
                  {t('快照', 'Snapshots')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingProj({ ...p })}
                  title={t('编辑元数据', 'Edit Metadata')}
                >
                  <Edit3 size={12} />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void handleCloneProject(p)}
                  data-testid={`project-clone-btn-${p.id}`}
                  title={t('克隆副本', 'Clone Project')}
                >
                  <Copy size={12} />
                </Button>
                {data.projects.length > 1 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-red hover:bg-red-tint hover:text-red"
                    onClick={() => setDeletingProj({ proj: p, needsForce: false })}
                    title={t('删除工程', 'Delete Project')}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Create Ontology Project Dialog */}
      <ConfirmDialog
        open={createOpen}
        title={t('新建业务本体工程', 'Create Ontology Project')}
        confirmLabel={t('立即创建', 'Create Project')}
        testId="create-project-dialog"
        onClose={() => setCreateOpen(false)}
        onConfirm={async () => {
          if (!newName.trim()) return;
          await createNewProject({
            name: newName.trim(),
            code: newCode.trim() || 'ONTO-NEW',
            center: newCenter,
            domain: newDomain.trim() || newName.trim(),
            description: newDescription.trim() || undefined,
            template: newTemplate,
          });
          setNewName('');
          setNewCode('');
          setNewDomain('');
          setNewDescription('');
          setCreateOpen(false);
        }}
      >
        <div className="space-y-3">
          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">{t('工程名称', 'Project Name')}</label>
              <input
                className="input"
                data-testid="new-project-name-input"
                placeholder="例如：供应链采购协同系统"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('工程编码', 'Project Code')}</label>
              <input
                className="input"
                data-testid="new-project-code-input"
                placeholder="例如：SCM-PROC"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
              />
            </div>
          </div>
          <div className="form-grid-2">
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
              <label className="form-label">{t('归属中心', 'Center')}</label>
              <select
                className="select"
                value={newCenter}
                onChange={(e) =>
                  setNewCenter(e.target.value as 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS')
                }
              >
                <option value="APPLICATION">APPLICATION (应用研发中心)</option>
                <option value="CAPABILITY">CAPABILITY (业务能力中心)</option>
                <option value="ANALYTICS">ANALYTICS (数据分析中心)</option>
              </select>
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">{t('工程简介', 'Description')}</label>
            <input
              className="input"
              placeholder="简述核心业务边界与建模目标…"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
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
        </div>
      </ConfirmDialog>

      {/* Edit Project Metadata Dialog */}
      <ConfirmDialog
        open={Boolean(editingProj)}
        title={t('编辑本体工程元数据', 'Edit Project Metadata')}
        confirmLabel={t('保存修改', 'Save Changes')}
        onClose={() => setEditingProj(null)}
        onConfirm={() => void handleSaveEditedProject()}
      >
        {editingProj && (
          <div className="space-y-3">
            <div className="form-grid-2">
              <div className="form-field">
                <label className="form-label">{t('工程名称', 'Name')}</label>
                <input
                  className="input"
                  value={editingProj.name}
                  onChange={(e) =>
                    setEditingProj({ ...editingProj, name: e.target.value })
                  }
                />
              </div>
              <div className="form-field">
                <label className="form-label">{t('工程编码', 'Code')}</label>
                <input
                  className="input"
                  value={editingProj.code}
                  onChange={(e) =>
                    setEditingProj({ ...editingProj, code: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="form-field">
              <label className="form-label">{t('业务领域', 'Domain')}</label>
              <input
                className="input"
                value={editingProj.domain}
                onChange={(e) =>
                  setEditingProj({ ...editingProj, domain: e.target.value })
                }
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('工程说明', 'Description')}</label>
              <input
                className="input"
                value={editingProj.description}
                onChange={(e) =>
                  setEditingProj({ ...editingProj, description: e.target.value })
                }
              />
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* Project Snapshots Manager Dialog */}
      <ConfirmDialog
        open={Boolean(snapshotProj)}
        title={
          snapshotProj
            ? `${t('11 模型里程碑快照管理', 'Project Snapshots')} — ${snapshotProj.name}`
            : ''
        }
        cancelLabel={t('关闭', 'Close')}
        onClose={() => setSnapshotProj(null)}
      >
        {snapshotProj && (
          <div className="space-y-3">
            <div className="rounded-card border border-line bg-inset/50 p-3 space-y-2">
              <div className="text-[12px] font-semibold text-ink">
                {t('创建当前 11 模型快照', 'Create New Milestone Snapshot')}
              </div>
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder={t('快照版本标签，如 v5.2 评审基线', 'Snapshot label…')}
                  value={snapLabel}
                  onChange={(e) => setSnapLabel(e.target.value)}
                />
                <Button
                  variant="accent"
                  size="sm"
                  data-testid="create-snapshot-confirm-btn"
                  onClick={() => void handleCreateSnapshot()}
                >
                  <Plus size={12.5} />
                  {t('保存快照', 'Snapshot')}
                </Button>
              </div>
              <input
                className="input"
                placeholder={t('快照备注说明（可选）', 'Optional note…')}
                value={snapNote}
                onChange={(e) => setSnapNote(e.target.value)}
              />
            </div>

            <div className="max-h-60 space-y-2 overflow-y-auto">
              {snapshotsForModal.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-ink-3">
                  {t('当前工程暂无历史快照', 'No snapshots yet for this project')}
                </div>
              ) : (
                snapshotsForModal.map((snap) => (
                  <div
                    key={snap.id}
                    className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{snap.label}</div>
                      <div className="text-[11px] text-ink-3">
                        {snap.presentModels.length}/11 Models · {snap.errorCount} Errors ·{' '}
                        {snap.createdAt.slice(0, 19).replace('T', ' ')}
                      </div>
                      {snap.note && (
                        <div className="text-[11.5px] text-ink-2">{snap.note}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => void handleRestoreSnapshot(snap)}
                      >
                        <RotateCcw size={11.5} />
                        {t('恢复', 'Restore')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-red"
                        onClick={async () => {
                          const res = await apiDeleteProjectSnapshot(
                            snapshotProj.id,
                            snap.id,
                          );
                          const other = (data.projectSnapshots ?? []).filter(
                            (s) => s.projectId !== snapshotProj.id,
                          );
                          patchData({ projectSnapshots: [...res.snapshots, ...other] });
                        }}
                      >
                        <Trash2 size={11.5} />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* Delete Project Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deletingProj)}
        danger
        title={t('删除本体工程', 'Delete Ontology Project')}
        confirmLabel={
          deletingProj?.needsForce
            ? t('强制级联删除工程及关联应用', 'Force Cascade Delete')
            : t('确认删除', 'Delete')
        }
        description={
          deletingProj?.conflictMsg ||
          (deletingProj
            ? t(
                `确认删除本体工程「${deletingProj.proj.name} (${deletingProj.proj.code})」吗？`,
                `Delete ontology project "${deletingProj.proj.name}"?`,
              )
            : '')
        }
        onClose={() => setDeletingProj(null)}
        onConfirm={() => void handleDeleteProjectConfirm()}
      />
    </div>
  );
}

// ─── 2. Requirement Exploration (需求探索 / Live Streaming + Scoped HITL) ──────
export function RequirementExploreView({
  onNavigate,
}: {
  onNavigate: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [synthesizingSrs, setSynthesizingSrs] = useState(false);

  useEffect(() => {
    if (!data) return;
    const exists = data.requirementSessions.some((s) => s.id === selectedSessionId);
    if (!exists) {
      setSelectedSessionId(data.requirementSessions[0]?.id ?? '');
    }
  }, [data?.activeProject.id, data?.requirementSessions, selectedSessionId]);

  // Extract additional domain signals from unified REQUIREMENT AgentSessions
  const extraReqArtifacts = useMemo(() => {
    const aggs = new Set<string>();
    const rules = new Set<string>();
    for (const sess of data?.agentSessions ?? []) {
      if (sess.projectId !== data?.activeProject.id || sess.agentKind !== 'REQUIREMENT') {
        continue;
      }
      for (const m of sess.messages) {
        for (const art of m.artifacts ?? []) {
          if (art.kind === 'REQUIREMENT_HINTS') {
            art.aggregates.forEach((a) => aggs.add(a));
            art.rules.forEach((r) => rules.add(r));
          }
        }
      }
    }
    return { aggs: [...aggs], rules: [...rules] };
  }, [data?.agentSessions, data?.activeProject.id]);

  if (!data) return null;
  const sessions = data.requirementSessions;
  const session =
    sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? undefined;

  const mergedAggs = [
    ...new Set([...(session?.discoveredAggregates ?? []), ...extraReqArtifacts.aggs]),
  ];
  const mergedRules = [
    ...new Set([...(session?.discoveredRules ?? []), ...extraReqArtifacts.rules]),
  ];

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
      {/* Top SRS Synthesis Header */}
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 className="card-title">
              {t(
                '交互式需求探索与 A/B 分级追问工作台 (Live Streaming + Scoped HITL)',
                'Interactive Requirement Exploration & Scoped HITL',
              )}
            </h3>
            {sessions.length > 0 && (
              <select
                className="select"
                style={{ width: 280 }}
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
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              type="button"
              variant="accent" size="md"
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
            </Button>
          </div>
        </div>
      </div>

      {/* Main Unified Streaming Agent + Right Convergence Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 350px', gap: 14 }}>
        <AgentSessionWorkbench
          agentKind="REQUIREMENT"
          height={580}
          title={t('需求探索与边界澄清智能体', 'Requirement Discovery Agent')}
          subtitle={t(
            'A 类常规项自动补全；遇到 B 类模糊业务边界时自动弹出交互式确认卡片',
            'Auto-completes Class-A defaults; pops up Scoped HITL card for Class-B decisions',
          )}
        />

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
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {(session?.resolvedDecisions ?? []).map((dec, idx) => {
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
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <span className={`badge ${parsed.badgeClass}`}>{parsed.tag}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {t(parsed.categoryLabelZh, parsed.categoryLabelEn)}
                      </span>
                    </div>
                    <div style={{ lineHeight: 1.45 }}>{parsed.body}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h4 className="card-title" style={{ marginBottom: 8 }}>
              {t('已识别领域聚合根 (M1)', 'Discovered Aggregates (M1)')}
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {mergedAggs.map((a) => (
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
              {mergedRules.map((r) => (
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
              <Button
                type="button"
                variant="accent" size="md"
                onClick={() => onNavigate('app-req-docs')}
              >
                {t('查看/编辑《软件需求说明书》 →', 'Open SRS Document →')}
              </Button>
              <Button
                type="button"
                variant="secondary" size="md"
                onClick={() => onNavigate('app-ontology')}
              >
                {t('打开 11 模型本体工作台 →', 'Open 11-Model Ontology →')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 3. Requirement Documents (需求文档 SRS: Registry + Tiptap Markdown) ─────
export function RequirementDocsView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [docTitle, setDocTitle] = useState<string>('');
  const [docVersion, setDocVersion] = useState<string>('v1.0');
  const [content, setContent] = useState<string>('');
  const [generatingProto, setGeneratingProto] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<RequirementDoc | null>(null);
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

  const handleSaveDoc = async (mdToSave = content) => {
    const targetId = selectedDoc?.id ?? `doc-${Date.now()}`;
    const res = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
      '/api/requirements/docs',
      {
        id: targetId,
        projectId: data.activeProject.id,
        title: docTitle.trim() || `${data.activeProject.name} 软件需求规格说明书`,
        version: docVersion.trim() || 'v1.0',
        content: mdToSave,
        status: 'CONFIRMED',
      },
    );
    patchData({ requirementDocs: res.docs });
    setSelectedDocId(res.doc.id);
    showToast(
      t(
        '《软件需求说明书》已保存并标记为 CONFIRMED',
        'SRS Document saved and marked CONFIRMED',
      ),
    );
  };

  const handleCreateBlankDoc = async () => {
    const res = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
      '/api/requirements/docs',
      {
        id: `doc-${Date.now()}`,
        projectId: data.activeProject.id,
        title: `${data.activeProject.name} 需求规格书 #${docs.length + 1}`,
        version: 'v1.0',
        content: `# ${data.activeProject.name} 软件需求规格说明书\n\n## 1. 业务目标与范围\n\n## 2. 核心领域对象与状态机\n\n| 对象名称 | 编码 | 核心职责 |\n| --- | --- | --- |\n| 示例聚合根 | AGG-01 | 核心业务单据 |\n`,
        status: 'DRAFT',
      },
    );
    patchData({ requirementDocs: res.docs });
    setSelectedDocId(res.doc.id);
    setPageMode('WORKSPACE');
    showToast(t('已新建需求规格书草稿', 'Created new SRS draft'));
  };

  const handleCloneDoc = async (doc: RequirementDoc) => {
    const res = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
      '/api/requirements/docs',
      {
        id: `doc-clone-${Date.now()}`,
        projectId: data.activeProject.id,
        title: `${doc.title} (副本)`,
        version: doc.version,
        content: doc.content,
        status: 'DRAFT',
      },
    );
    patchData({ requirementDocs: res.docs });
    showToast(t(`已克隆文档「${doc.title}」`, `Cloned "${doc.title}"`));
  };

  const handleConfirmDeleteDoc = async () => {
    if (!deletingDoc) return;
    const res = await apiDeleteResource<{ docs: RequirementDoc[] }>(
      `/api/requirements/docs/${deletingDoc.id}?projectId=${data.activeProject.id}`,
    );
    patchData({ requirementDocs: res.docs });
    setDeletingDoc(null);
    showToast(t('已删除需求规格书', 'Deleted SRS document'));
  };

  const handleUploadMdFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const baseTitle =
      file.name.replace(/\.(md|txt)$/i, '') || `${data.activeProject.name} 需求规格书`;
    const res = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
      '/api/requirements/docs',
      {
        id: `doc-upload-${Date.now()}`,
        projectId: data.activeProject.id,
        title: baseTitle,
        version: 'v1.0',
        content: text,
        status: 'CONFIRMED',
      },
    );
    patchData({ requirementDocs: res.docs });
    setSelectedDocId(res.doc.id);
    setDocTitle(res.doc.title);
    setDocVersion(res.doc.version);
    setContent(text);
    setPageMode('WORKSPACE');
    showToast(
      t(
        `已导入本地需求规格书「${file.name}」并保存`,
        `Imported and saved Markdown document "${file.name}"`,
      ),
    );
  };

  const handleGeneratePrototype = async () => {
    if (generatingProto) return;
    setGeneratingProto(true);
    try {
      let targetDocId = selectedDoc?.id;
      if (!targetDocId && content.trim()) {
        const saveJson = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
          '/api/requirements/docs',
          {
            id: `doc-${Date.now()}`,
            projectId: data.activeProject.id,
            title: docTitle.trim() || `${data.activeProject.name} 软件需求规格说明书`,
            version: docVersion.trim() || 'v1.0',
            content,
            status: 'CONFIRMED',
          },
        );
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
    <div className="space-y-3">
      <input
        ref={mdUploadRef}
        type="file"
        accept=".md,.txt"
        style={{ display: 'none' }}
        onChange={handleUploadMdFile}
      />

      <ViewModeHeader
        mode={pageMode}
        onChange={setPageMode}
        workspaceLabel={t('Tiptap 规格书工作台', 'SRS Editor Workspace')}
        registryLabel={t('规格书版本管理列表', 'SRS Document Registry')}
        count={docs.length}
        testIdPrefix="srs"
        rightActions={
          <>
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={() => mdUploadRef.current?.click()}
            >
              {t('上传本地 .md', 'Upload .md')}
            </Button>
            <Button
              type="button"
              variant="accent" size="sm"
              data-testid="generate-prototype-btn"
              disabled={generatingProto}
              onClick={handleGeneratePrototype}
            >
              {generatingProto
                ? t('正在生成交互原型...', 'Generating Prototype...')
                : t('基于此需求生成可交互 HTML 原型 →', 'Generate HTML Prototype →')}
            </Button>
          </>
        }
      />

      {pageMode === 'REGISTRY' ? (
        <RegistryTable<RequirementDoc>
          testId="srs-registry-table"
          title={t('软件需求规格说明书注册表', 'SRS Document Registry')}
          subtitle={t(
            '管理多版本需求规格书草稿、评审确认状态、副本克隆与清理',
            'Manage multi-version SRS documents, statuses, clones, and cleanup',
          )}
          rows={docs}
          getRowKey={(d) => d.id}
          activeRowKey={selectedDoc?.id}
          matchesSearch={(d, q) =>
            d.title.toLowerCase().includes(q) ||
            d.version.toLowerCase().includes(q) ||
            d.content.toLowerCase().includes(q)
          }
          statusFilters={[
            { value: 'ALL', label: t('全部', 'All') },
            { value: 'DRAFT', label: 'DRAFT' },
            { value: 'CONFIRMED', label: 'CONFIRMED' },
            { value: 'PUBLISHED', label: 'PUBLISHED' },
          ]}
          getRowStatus={(d) => d.status}
          primaryActionLabel={t('新建需求规格书', 'New SRS Doc')}
          onPrimaryAction={() => void handleCreateBlankDoc()}
          onRowClick={(d) => {
            setSelectedDocId(d.id);
            setPageMode('WORKSPACE');
          }}
          columns={[
            {
              key: 'title',
              header: t('文档标题', 'Title'),
              render: (d) => (
                <div>
                  <div className="font-semibold text-ink">{d.title}</div>
                  <div className="font-mono text-[11px] text-ink-3">{d.id}</div>
                </div>
              ),
            },
            {
              key: 'version',
              header: t('版本', 'Version'),
              width: '100px',
              render: (d) => <span className="badge badge-accent">{d.version}</span>,
            },
            {
              key: 'status',
              header: t('状态', 'Status'),
              width: '120px',
              render: (d) => <span className="badge badge-ok">{d.status}</span>,
            },
            {
              key: 'updatedAt',
              header: t('更新时间', 'Updated'),
              width: '170px',
              render: (d) => (
                <span className="font-mono text-[11.5px] text-ink-3">
                  {d.updatedAt.slice(0, 19).replace('T', ' ')}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('操作', 'Actions'),
              align: 'right',
              render: (d) => (
                <div
                  className="inline-flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      setSelectedDocId(d.id);
                      setPageMode('WORKSPACE');
                    }}
                  >
                    {t('编辑', 'Edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void handleCloneDoc(d)}
                    title={t('克隆副本', 'Clone')}
                  >
                    <Copy size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-red"
                    onClick={() => setDeletingDoc(d)}
                    title={t('删除', 'Delete')}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      ) : (
        <div className="space-y-3">
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {docs.length > 1 && (
                  <select
                    className="select"
                    style={{ width: 240 }}
                    value={selectedDoc?.id ?? ''}
                    onChange={(e) => setSelectedDocId(e.target.value)}
                  >
                    {docs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({d.version})
                      </option>
                    ))}
                  </select>
                )}
                <input
                  className="input"
                  style={{ width: 260 }}
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder={t('文档标题', 'Document Title')}
                />
                <input
                  className="input"
                  style={{ width: 88, fontFamily: 'var(--mono)' }}
                  value={docVersion}
                  onChange={(e) => setDocVersion(e.target.value)}
                  placeholder="v1.0"
                />
                {selectedDoc && (
                  <span className="badge badge-ok">{selectedDoc.status}</span>
                )}
              </div>
              <Button variant="secondary" size="xs" onClick={() => void handleCreateBlankDoc()}>
                <Plus size={12} />
                {t('新建空白规格书', 'New Draft')}
              </Button>
            </div>
          </div>

          <TiptapMarkdownEditor
            title={docTitle || t('软件需求规格说明书 (SRS)', 'SRS Specification')}
            value={content}
            onChange={setContent}
            onSave={handleSaveDoc}
            saveLabel={t('保存并确认规格书', 'Save & Confirm SRS')}
            downloadFilename={`${(docTitle || 'SRS').replace(/[\\/:*?"<>|]+/g, '_')}-${docVersion}.md`}
            minHeight={500}
          />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletingDoc)}
        danger
        title={t('删除需求规格书', 'Delete SRS Document')}
        description={
          deletingDoc ? t(`确认删除「${deletingDoc.title}」吗？`, `Delete "${deletingDoc.title}"?`) : ''
        }
        onClose={() => setDeletingDoc(null)}
        onConfirm={() => void handleConfirmDeleteDoc()}
      />
    </div>
  );
}

// ─── 4. UI Prototype & MU Sync (界面原型: Registry + Studio) ──────────────────
export function PrototypeStudioView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedProtoId, setSelectedProtoId] = useState<string>('');
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [viewMode, setViewMode] = useState<'SPLIT' | 'PREVIEW' | 'HTML'>('SPLIT');

  const [refineInstruction, setRefineInstruction] = useState<string>('');
  const [refining, setRefining] = useState(false);
  const [synthesizingOntology, setSynthesizingOntology] = useState(false);
  const [synthesisSummary, setSynthesisSummary] = useState<{
    modelCount: number;
    errorCount: number;
  } | null>(null);
  const [deletingProto, setDeletingProto] = useState<PrototypeArtifact | null>(null);
  const htmlUploadRef = useRef<HTMLInputElement | null>(null);

  const prototypes = data?.prototypes ?? [];
  const proto = prototypes.find((p) => p.id === selectedProtoId) ?? prototypes[0];

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
    setPageMode('WORKSPACE');
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

  const handleDeleteProtoConfirm = async () => {
    if (!deletingProto) return;
    const res = await apiDeleteResource<{ prototypes: PrototypeArtifact[] }>(
      `/api/prototypes/${deletingProto.id}?projectId=${data.activeProject.id}`,
    );
    patchData({ prototypes: res.prototypes });
    setDeletingProto(null);
    showToast(t('已删除原型版本', 'Deleted prototype artifact'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        ref={htmlUploadRef}
        type="file"
        accept=".html,.htm"
        style={{ display: 'none' }}
        onChange={handleUploadHtml}
      />

      <ViewModeHeader
        mode={pageMode}
        onChange={setPageMode}
        workspaceLabel={t('HTML 原型与 MU 锚定工作台', 'Prototype Studio')}
        registryLabel={t('原型版本管理列表', 'Prototype Registry')}
        count={prototypes.length}
        testIdPrefix="proto"
        rightActions={
          <>
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={() => htmlUploadRef.current?.click()}
            >
              {t('上传 .html', 'Upload .html')}
            </Button>
            <Button
              type="button"
              variant="secondary" size="sm"
              data-testid="sync-prototype-mu-btn"
              onClick={handleSaveAndExtractMu}
            >
              {t('保存原型并提取同步至 MU 模型', 'Save & Extract to MU Model')}
            </Button>
            <Button
              type="button"
              variant="accent" size="sm"
              data-testid="confirm-prototype-synthesize-btn"
              disabled={synthesizingOntology}
              onClick={handleConfirmAndSynthesizeOntology}
            >
              {synthesizingOntology
                ? t('正在合成 11 模型...', 'Synthesizing 11 Models...')
                : t('确认原型并一键合成 11 元模型本体', 'Confirm & Synthesize 11-Model')}
            </Button>
          </>
        }
      />

      {pageMode === 'REGISTRY' ? (
        <RegistryTable<PrototypeArtifact>
          testId="prototype-registry-table"
          title={t('可交互界面原型版本注册表', 'Interactive HTML Prototype Registry')}
          subtitle={t(
            '管理不同迭代版本的语义锚点 HTML 原型、MU 提取屏幕数与生命周期',
            'Manage semantic HTML prototype versions and MU screen extraction counts',
          )}
          rows={prototypes}
          getRowKey={(p) => p.id}
          activeRowKey={proto?.id}
          matchesSearch={(p, q) =>
            p.name.toLowerCase().includes(q) || p.version.toLowerCase().includes(q)
          }
          primaryActionLabel={t('AI 生成新原型版本', 'Generate New Prototype')}
          onPrimaryAction={async () => {
            const res = await apiGeneratePrototype(data.activeProject.id, {});
            patchData({ prototypes: res.prototypes, activeProject: res.project });
            setSelectedProtoId(res.prototype.id);
            setPageMode('WORKSPACE');
          }}
          onRowClick={(p) => {
            setSelectedProtoId(p.id);
            setPageMode('WORKSPACE');
          }}
          columns={[
            {
              key: 'name',
              header: t('原型文件名称', 'Prototype Name'),
              render: (p) => (
                <div>
                  <div className="font-semibold text-ink">{p.name}</div>
                  <div className="font-mono text-[11px] text-ink-3">{p.id}</div>
                </div>
              ),
            },
            {
              key: 'version',
              header: t('版本', 'Version'),
              width: '100px',
              render: (p) => <span className="badge badge-accent">{p.version}</span>,
            },
            {
              key: 'screens',
              header: t('提取 MU 屏幕数', 'MU Screens'),
              width: '140px',
              render: (p) => (
                <span className="badge badge-ok">{p.extractedScreenCount} Screens</span>
              ),
            },
            {
              key: 'updatedAt',
              header: t('更新时间', 'Updated'),
              width: '170px',
              render: (p) => (
                <span className="font-mono text-[11.5px] text-ink-3">
                  {p.updatedAt.slice(0, 19).replace('T', ' ')}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('操作', 'Actions'),
              align: 'right',
              render: (p) => (
                <div
                  className="inline-flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      setSelectedProtoId(p.id);
                      setPageMode('WORKSPACE');
                    }}
                  >
                    {t('打开工作台', 'Studio')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-red"
                    onClick={() => setDeletingProto(p)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      ) : (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {prototypes.length > 0 && (
                  <select
                    className="select"
                    style={{ width: 250 }}
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
                <Button type="button" variant="secondary" size="sm" onClick={handleDownloadHtml}>
                  {t('下载 .html', 'Download .html')}
                </Button>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="toggle" size="sm" aria-pressed={viewMode === 'SPLIT'}
                  onClick={() => setViewMode('SPLIT')}
                >
                  {t('分栏联调', 'Split View')}
                </Button>
                <Button
                  type="button"
                  variant="toggle" size="sm" aria-pressed={viewMode === 'PREVIEW'}
                  onClick={() => setViewMode('PREVIEW')}
                >
                  {t('仅看原型', 'Preview Only')}
                </Button>
                <Button
                  type="button"
                  variant="toggle" size="sm" aria-pressed={viewMode === 'HTML'}
                  onClick={() => setViewMode('HTML')}
                >
                  {t('HTML 源码', 'HTML Source')}
                </Button>
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
                  'Describe UI refinement, e.g. Add overdue milestone KPI banner...',
                )}
                value={refineInstruction}
                onChange={(e) => setRefineInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRefinePrototype();
                }}
              />
              <Button
                type="button"
                variant="accent" size="md"
                data-testid="refine-prototype-btn"
                disabled={refining || !refineInstruction.trim()}
                onClick={handleRefinePrototype}
              >
                {refining ? t('精修中...', 'Refining...') : t('AI 精修并同步 MU', 'Refine & Sync MU')}
              </Button>
            </div>

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
                  {synthesisSummary.modelCount}/11 Models · {synthesisSummary.errorCount}{' '}
                  Consistency Errors
                </div>
                <Button
                  type="button"
                  variant="accent" size="sm"
                  onClick={() => onNavigate?.('app-ontology')}
                >
                  {t('前往 11 模型本体工作台查看 →', 'Open 11-Model Ontology Workbench →')}
                </Button>
              </div>
            )}
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
                    {proto?.extractedScreenCount ??
                      data.activeProject.suite.MU?.screens.length ??
                      0}{' '}
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
        </>
      )}

      <ConfirmDialog
        open={Boolean(deletingProto)}
        danger
        title={t('删除界面原型版本', 'Delete Prototype Version')}
        description={
          deletingProto
            ? t(`确认删除原型「${deletingProto.name}」吗？`, `Delete "${deletingProto.name}"?`)
            : ''
        }
        onClose={() => setDeletingProto(null)}
        onConfirm={() => void handleDeleteProtoConfirm()}
      />
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
      for (const code of MODEL_CODES) {
        const canonicalName = MODEL_FILE_NAMES[code].toLowerCase();
        const lower = file.name.toLowerCase();
        if (
          lower === canonicalName ||
          lower.startsWith(`${code.toLowerCase()}-`) ||
          lower === `${code.toLowerCase()}.yaml` ||
          lower === `${code.toLowerCase()}.yml`
        ) {
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
            <Button
              type="button"
              variant="secondary" size="md"
              onClick={() => yamlImportRef.current?.click()}
            >
              {t('导入 YAML 文件', 'Import YAML Files')}
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={handleDownloadCurrentFile}>
              {t('下载当前文件', 'Download Current File')}
            </Button>
            <Button
              type="button"
              variant="secondary" size="md"
              data-testid="export-owl-btn"
              onClick={handleExportOwl}
            >
              {t('导出 OWL 标准本体', 'Export OWL XML')}
            </Button>
            <Button
              type="button"
              variant="secondary" size="md"
              data-testid="generate-skill-btn"
              onClick={handleGenerateSkill}
            >
              {t('生成渐进式 SKILL.md', 'Generate SKILL.md')}
            </Button>
            <Button
              type="button"
              variant="accent" size="md"
              data-testid="publish-mcp-btn"
              onClick={handlePublishMcp}
            >
              {t('发布为在线 MCP Server', 'Publish MCP Server')}
            </Button>
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
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={() => setImportErrors([])}
            >
              {t('清除提示', 'Dismiss')}
            </Button>
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

        <div>
          <CodeBlock
            code={currentContent}
            language={selectedFile === 'MANIFEST' ? 'json' : 'yaml'}
            filename={currentTitle}
            maxHeight={560}
          />
        </div>
      </div>

      {owlPreview && (
        <div className="modal-backdrop" onClick={() => setOwlPreview(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">W3C OWL/RDF XML — {project.name}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  type="button"
                  variant="secondary" size="sm"
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
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setOwlPreview(null)}>
                  ✕
                </Button>
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

// ─── 6. Four-Layer Architecture Assets (四层架构资产: CRUD + Tiptap Markdown) ─
export function FourLayerAssetsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [filterLayer, setFilterLayer] = useState<'ALL' | 'UI_UE' | 'TECH_FOUNDATION' | 'TECH_ARCH'>(
    'ALL',
  );

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
  const [deletingAsset, setDeletingAsset] = useState<FourLayerAsset | null>(null);

  const [archName, setArchName] = useState('云原生 DDD 四层技术架构规范');
  const [archStackTags, setArchStackTags] = useState(
    'TypeScript, Hono, React 19, Drizzle SQLite/D1',
  );
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
      specMarkdown: '# 架构资产规范说明\n\n## 1. 核心约束\n- 严格遵循 Deep Modules 边界规范\n',
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
      const json = await apiPostJson<{
        asset: FourLayerAsset;
        fourLayerAssets: FourLayerAsset[];
      }>('/api/assets', {
        id: editingAsset.id,
        layer: editingAsset.layer,
        name: editingAsset.name.trim(),
        version: editingAsset.version.trim() || 'v1.0',
        summary: editingAsset.summary.trim() || editingAsset.name.trim(),
        tags,
        specMarkdown: editingAsset.specMarkdown,
      });
      patchData({ fourLayerAssets: json.fourLayerAssets });
      setEditingAsset(null);
      showToast(t(`已保存四层架构资产「${json.asset.name}」`, `Saved asset "${json.asset.name}"`));
    } finally {
      setSavingAsset(false);
    }
  };

  const handleCloneAsset = async (asset: FourLayerAsset) => {
    const json = await apiPostJson<{
      asset: FourLayerAsset;
      fourLayerAssets: FourLayerAsset[];
    }>('/api/assets', {
      id: `${asset.id}-copy-${Date.now().toString(36)}`,
      layer: asset.layer,
      name: `${asset.name} (副本)`,
      version: asset.version,
      summary: asset.summary,
      tags: asset.tags,
      specMarkdown: asset.specMarkdown,
    });
    patchData({ fourLayerAssets: json.fourLayerAssets });
    showToast(t(`已克隆架构资产「${asset.name}」`, `Cloned asset "${asset.name}"`));
  };

  const handleConfirmDeleteAsset = async () => {
    if (!deletingAsset) return;
    try {
      const res = await apiDeleteResource<{ fourLayerAssets: FourLayerAsset[] }>(
        `/api/assets/${deletingAsset.id}`,
      );
      patchData({ fourLayerAssets: res.fourLayerAssets });
      setDeletingAsset(null);
      showToast(t('已删除四层架构资产', 'Deleted 4-layer asset'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败');
      setDeletingAsset(null);
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
                '与业务本体自由组合装配，支持 Tiptap 富文本编辑规范文档与引用保护删除',
                'Freely assemble with any Ontology Suite, edit specs via Tiptap, or synthesize from tech stack',
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['ALL', 'UI_UE', 'TECH_FOUNDATION', 'TECH_ARCH'] as const).map((ly) => (
              <Button
                key={ly}
                type="button"
                variant="toggle" size="sm" aria-pressed={filterLayer === ly}
                onClick={() => setFilterLayer(ly)}
              >
                {t(layerLabels[ly].zh, layerLabels[ly].en)}
              </Button>
            ))}
            <Button type="button" variant="accent" size="sm" onClick={openNewAssetModal}>
              + {t('新建架构资产', 'New Asset')}
            </Button>
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
          </div>
          <Button
            type="button"
            variant="accent" size="md"
            data-testid="generate-tech-arch-btn"
            disabled={generatingArch}
            onClick={handleGenerateTechArch}
          >
            {generatingArch
              ? t('正在生成架构文档...', 'Generating Tech Arch...')
              : t('AI 技术栈生成《技术架构设计文档》', 'Generate Tech Architecture Doc')}
          </Button>
        </div>

        <div className="form-grid-3">
          <div className="form-field">
            <label className="form-label">{t('架构资产名称', 'Architecture Asset Name')}</label>
            <input
              className="input"
              value={archName}
              onChange={(e) => setArchName(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('技术栈标签 (逗号分隔)', 'Tech Stack Tags')}</label>
            <input
              className="input"
              value={archStackTags}
              onChange={(e) => setArchStackTags(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('补充架构约束 (可选)', 'Additional Constraints')}</label>
            <input
              className="input"
              value={archPrompt}
              onChange={(e) => setArchPrompt(e.target.value)}
              placeholder={t('例如：要求严格的 Deep Modules 边界', 'e.g. Strict module boundaries')}
            />
          </div>
        </div>
      </div>

      {/* Asset Cards Grid with Rendered Markdown Preview */}
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
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span className="badge badge-ok">{asset.version}</span>
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  onClick={() => openEditAssetModal(asset)}
                >
                  {t('编辑规范', 'Edit')}
                </Button>
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  onClick={() => void handleCloneAsset(asset)}
                  title={t('克隆副本', 'Clone')}
                >
                  <Copy size={12} />
                </Button>
                <Button
                  type="button"
                  variant="danger" size="sm"
                  onClick={() => setDeletingAsset(asset)}
                  title={t('删除资产', 'Delete')}
                >
                  <Trash2 size={12} />
                </Button>
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

            <div className="max-h-52 overflow-y-auto rounded-card border border-line bg-inset/35 p-3">
              <MarkdownRenderer content={asset.specMarkdown} />
            </div>
          </div>
        ))}
      </div>

      {/* Tiptap Asset Editor Modal */}
      {editingAsset && (
        <div className="modal-backdrop" onClick={() => setEditingAsset(null)}>
          <div
            className="modal-panel"
            style={{ maxWidth: 880 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 className="card-title">
                {t('编辑四层架构资产规范 (Tiptap Markdown)', 'Edit 4-Layer Architecture Asset')}
              </h3>
              <Button
                type="button"
                variant="secondary" size="sm"
                onClick={() => setEditingAsset(null)}
              >
                ✕
              </Button>
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

              <TiptapMarkdownEditor
                value={editingAsset.specMarkdown}
                onChange={(md) => setEditingAsset({ ...editingAsset, specMarkdown: md })}
                onSave={handleSaveAsset}
                saving={savingAsset}
                saveLabel={t('保存架构资产', 'Save Asset')}
                minHeight={300}
              />
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletingAsset)}
        danger
        title={t('删除四层架构资产', 'Delete 4-Layer Asset')}
        description={
          deletingAsset
            ? t(
                `确认删除资产「${deletingAsset.name}」吗？（若已被四层装配应用引用，系统将自动拦截保护）`,
                `Delete "${deletingAsset.name}"? (Protected if referenced by an assembled app)`,
              )
            : ''
        }
        onClose={() => setDeletingAsset(null)}
        onConfirm={() => void handleConfirmDeleteAsset()}
      />
    </div>
  );
}

// ─── 7. Application Assembly & Dev Package Compiler (应用开发) ───────────────
export function ApplicationAssemblyDevView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [compiledPkg, setCompiledPkg] = useState<CompiledDevelopmentPackage | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('开发指导书.md');
  const [pkgPreviewRaw, setPkgPreviewRaw] = useState(false);

  const [newAppOpen, setNewAppOpen] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [selProjectId, setSelProjectId] = useState('');
  const [selUiAssetId, setSelUiAssetId] = useState('');
  const [selFoundationId, setSelFoundationId] = useState('');
  const [selArchId, setSelArchId] = useState('');
  const [deletingApp, setDeletingApp] = useState<AssembledApplication | null>(null);
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
    const json = await apiPostJson<{ assembledApplications: AssembledApplication[] }>(
      '/api/applications',
      {
        ...app,
        ...patch,
      },
    );
    patchData({ assembledApplications: json.assembledApplications });
    showToast(t('已更新四层架构装配绑定', 'Updated 4-layer assembly binding'));
  };

  const handleCreateApplication = async () => {
    const targetProject =
      data.projects.find((p) => p.id === (selProjectId || data.activeProject.id)) ??
      data.activeProject;
    const name = newAppName.trim() || `${targetProject.name} 四层装配应用`;
    const json = await apiPostJson<{
      application: AssembledApplication;
      assembledApplications: AssembledApplication[];
    }>('/api/applications', {
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
    });
    patchData({ assembledApplications: json.assembledApplications });
    setSelectedAppId(json.application.id);
    setNewAppName('');
    setNewAppOpen(false);
    setPageMode('WORKSPACE');
    showToast(t(`已创建装配应用「${name}」`, `Created assembled application "${name}"`));
  };

  const handleConfirmDeleteApp = async () => {
    if (!deletingApp) return;
    const res = await apiDeleteResource<{ assembledApplications: AssembledApplication[] }>(
      `/api/applications/${deletingApp.id}`,
    );
    patchData({ assembledApplications: res.assembledApplications });
    setDeletingApp(null);
    showToast(t('已删除四层装配应用', 'Deleted assembled application'));
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

  const activeFile = compiledPkg?.files.find((f) => f.relativePath === selectedFilePath);
  const isMarkdownArtifact = Boolean(activeFile?.relativePath.endsWith('.md'));
  const boundProject =
    data.projects.find((p) => p.id === app?.projectId) ?? data.activeProject;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ViewModeHeader
        mode={pageMode}
        onChange={setPageMode}
        workspaceLabel={t('四层装配与开发工作台', 'Assembly & Dev Workspace')}
        registryLabel={t('装配应用管理注册表', 'Assembled App Registry')}
        count={apps.length}
        testIdPrefix="app-assembly"
        rightActions={
          <>
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={() => setNewAppOpen(true)}
            >
              + {t('新建四层装配应用', 'New Assembled App')}
            </Button>
            <Button
              type="button"
              variant="secondary" size="sm"
              data-testid="download-package-zip-btn"
              disabled={!app || downloadingZip}
              onClick={handleDownloadPackageZip}
            >
              {downloadingZip
                ? t('正在打包...', 'Packaging...')
                : t('下载 .zip 开发资料包', 'Download .zip Dev Package')}
            </Button>
            <Button
              type="button"
              variant="accent" size="sm"
              data-testid="compile-dev-package-btn"
              disabled={!app}
              onClick={handleCompilePackage}
            >
              {t('一键编译生成《开发资料包》', 'Compile Development Package')}
            </Button>
          </>
        }
      />

      {pageMode === 'REGISTRY' ? (
        <RegistryTable<AssembledApplication>
          testId="assembled-app-registry"
          title={t('四层架构装配应用注册表', '4-Layer Assembled Application Registry')}
          subtitle={t(
            '管理【业务本体 + UI/UE + 技术底座 + 技术架构】四层组装实例、编译状态与发布路由',
            'Manage 4-layer assembled application instances, compilation status, and release endpoints',
          )}
          rows={apps}
          getRowKey={(a) => a.id}
          activeRowKey={app?.id}
          matchesSearch={(a, q) =>
            a.name.toLowerCase().includes(q) ||
            (a.publishedEndpoint || '').toLowerCase().includes(q)
          }
          statusFilters={[
            { value: 'ALL', label: t('全部', 'All') },
            { value: 'ASSEMBLED', label: 'ASSEMBLED' },
            { value: 'COMPILED', label: 'COMPILED' },
            { value: 'PUBLISHED', label: 'PUBLISHED' },
          ]}
          getRowStatus={(a) => a.status}
          primaryActionLabel={t('新建四层装配应用', 'New Assembled App')}
          onPrimaryAction={() => setNewAppOpen(true)}
          onRowClick={(a) => {
            setSelectedAppId(a.id);
            setPageMode('WORKSPACE');
          }}
          columns={[
            {
              key: 'name',
              header: t('应用名称', 'Application Name'),
              render: (a) => (
                <div>
                  <div className="font-semibold text-ink">{a.name}</div>
                  <div className="font-mono text-[11px] text-ink-3">
                    {a.publishedEndpoint || `/apps/${a.id}`}
                  </div>
                </div>
              ),
            },
            {
              key: 'project',
              header: t('绑定业务本体', 'Ontology Project'),
              render: (a) => {
                const p = data.projects.find((pr) => pr.id === a.projectId);
                return <span className="badge badge-accent">{p?.name || a.projectId}</span>;
              },
            },
            {
              key: 'status',
              header: t('状态 / 版本', 'Status'),
              width: '150px',
              render: (a) => (
                <span className="badge badge-ok">
                  {a.status} · {a.publishedVersion || 'v1.0.0'}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('操作', 'Actions'),
              align: 'right',
              render: (a) => (
                <div
                  className="inline-flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      setSelectedAppId(a.id);
                      setPageMode('WORKSPACE');
                    }}
                  >
                    {t('打开研发台', 'Workspace')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-red"
                    onClick={() => setDeletingApp(a)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      ) : (
        <>
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <strong className="text-[13.5px]">
                  {t('当前装配应用：', 'Active Application: ')}
                </strong>
                {apps.length > 0 && (
                  <select
                    className="select"
                    style={{ width: 260 }}
                    value={app?.id ?? ''}
                    onChange={(e) => {
                      setSelectedAppId(e.target.value);
                      setCompiledPkg(null);
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
              {app && <span className="badge badge-ok">{app.status}</span>}
            </div>

            {app && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: 10,
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
                </div>
              </div>
            )}
          </div>

          {/* Compiled Progressive-Disclosure Development Package Inspector */}
          {compiledPkg && (
            <div
              style={{ display: 'grid', gridTemplateColumns: '330px minmax(0, 1fr)', gap: 12 }}
              data-testid="compiled-package-inspector"
            >
              <div className="card" style={{ maxHeight: 540, overflowY: 'auto' }}>
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

              <div className="card" style={{ maxHeight: 540, overflowY: 'auto' }}>
                <div className="card-header">
                  <strong style={{ fontFamily: 'var(--mono)' }}>
                    {activeFile?.relativePath}
                  </strong>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {isMarkdownArtifact && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setPkgPreviewRaw((v) => !v)}
                      >
                        {pkgPreviewRaw ? <Eye size={12} /> : <FileCode size={12} />}
                        {pkgPreviewRaw ? t('富排版预览', 'Rendered') : t('查看源码', 'Raw')}
                      </Button>
                    )}
                    <span className="badge badge-ok">{activeFile?.sizeBytes} bytes</span>
                    {activeFile && (
                      <Button
                        type="button"
                        variant="secondary" size="sm"
                        onClick={() =>
                          triggerBrowserDownload(
                            activeFile.relativePath.split('/').pop() || 'artifact.md',
                            activeFile.content,
                          )
                        }
                      >
                        {t('下载单文件', 'Download File')}
                      </Button>
                    )}
                  </div>
                </div>

                {activeFile &&
                  (isMarkdownArtifact && !pkgPreviewRaw ? (
                    <div className="p-2">
                      <MarkdownRenderer content={activeFile.content} />
                    </div>
                  ) : (
                    <CodeBlock
                      code={activeFile.content}
                      language={activeFile.relativePath.split('.').pop() || 'text'}
                      filename={activeFile.relativePath}
                      maxHeight={440}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Unified Streaming AI Coding Agent + Real-Time Logs */}
          {app && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 12 }}>
              <AgentSessionWorkbench
                agentKind="CODING"
                targetId={app.id}
                height={480}
                title={t('四层架构 AI 研发智能体 (Coding Agent)', '4-Layer AI Coding Agent')}
                subtitle={t(
                  '基于渐进式《开发资料包》执行代码骨架生成、包编译与门禁校验',
                  'Generates domain repositories, routes, UI components & compiles dev packages',
                )}
              />

              <div className="card" style={{ maxHeight: 480, overflowY: 'auto' }}>
                <div className="card-header">
                  <h4 className="card-title">
                    {t('构建与发布流水日志', 'Build & Release Logs')} ({app.agentDevLogs.length})
                  </h4>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        </>
      )}

      {/* New Assembled App Dialog */}
      <ConfirmDialog
        open={newAppOpen}
        title={t('新建四层架构装配应用', 'Create 4-Layer Assembled Application')}
        confirmLabel={t('确认组装应用', 'Create Application')}
        onClose={() => setNewAppOpen(false)}
        onConfirm={() => void handleCreateApplication()}
      >
        <div className="space-y-3">
          <div className="form-field">
            <label className="form-label">{t('应用名称', 'Application Name')}</label>
            <input
              className="input"
              value={newAppName}
              onChange={(e) => setNewAppName(e.target.value)}
              placeholder={t('例如：合同履约管理微服务应用', 'e.g. Contract Management App')}
            />
          </div>
          <div className="form-grid-2">
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
                    {a.name}
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
                    {a.name}
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
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deletingApp)}
        danger
        title={t('删除四层装配应用', 'Delete Assembled Application')}
        description={
          deletingApp
            ? t(`确认删除应用「${deletingApp.name}」吗？`, `Delete "${deletingApp.name}"?`)
            : ''
        }
        onClose={() => setDeletingApp(null)}
        onConfirm={() => void handleConfirmDeleteApp()}
      />
    </div>
  );
}

// ─── 8. Skills & Application Publish Views ───────────────────────────────────
export function OntologySkillsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');
  const [skillDraft, setSkillDraft] = useState<string>('');
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<GeneratedSkill | null>(null);

  const skills = data?.generatedSkills ?? [];
  const activeSkill =
    skills.find((s) => s.id === selectedSkillId) ??
    skills.find((s) => s.projectId === data?.activeProject.id) ??
    skills[0];

  useEffect(() => {
    if (skills.length > 0 && !skills.some((s) => s.id === selectedSkillId)) {
      const preferred =
        skills.find((s) => s.projectId === data?.activeProject.id) ?? skills[0];
      setSelectedSkillId(preferred.id);
    }
  }, [skills, selectedSkillId, data?.activeProject.id]);

  useEffect(() => {
    setSkillDraft(activeSkill?.skillMarkdown ?? '');
  }, [activeSkill?.id, activeSkill?.updatedAt, activeSkill?.skillMarkdown]);

  if (!data) return null;

  const targetCompileProjectId =
    pageMode === 'WORKSPACE' && activeSkill ? activeSkill.projectId : data.activeProject.id;

  const executeCompileSkill = async () => {
    const res = await fetch(`/api/projects/${targetCompileProjectId}/generate-skill`, {
      method: 'POST',
    });
    const json = await res.json();
    patchData({ generatedSkills: json.skills });
    setSelectedSkillId(json.skill.id);
    setConfirmOverwriteOpen(false);
    showToast(`已生成业务本体技能包 ${json.skill.slug}`);
  };

  const handleRequestCompile = () => {
    const existingForProj = skills.find((s) => s.projectId === targetCompileProjectId);
    if (existingForProj?.isCustomRefined) {
      setConfirmOverwriteOpen(true);
      return;
    }
    void executeCompileSkill();
  };

  const handleSaveRefinedSkill = async (mdToSave = skillDraft) => {
    if (!activeSkill) return;
    const res = await apiPutJson<{ skill: GeneratedSkill; skills: GeneratedSkill[] }>(
      `/api/skills/${activeSkill.id}`,
      {
        skillMarkdown: mdToSave,
      },
    );
    patchData({ generatedSkills: res.skills });
    showToast(
      t(
        `已保存手工精修版 ${res.skill.slug}/SKILL.md（重新编译前将自动提示保护）`,
        `Saved custom-refined ${res.skill.slug}/SKILL.md`,
      ),
    );
  };

  const handleDeleteSkillConfirm = async () => {
    if (!deletingSkill) return;
    const res = await apiDeleteResource<{ skills: GeneratedSkill[] }>(
      `/api/skills/${deletingSkill.id}`,
    );
    patchData({ generatedSkills: res.skills });
    setDeletingSkill(null);
    showToast(t('已删除本体技能包', 'Deleted ontology skill'));
  };

  return (
    <div className="space-y-3">
      <ViewModeHeader
        mode={pageMode}
        onChange={setPageMode}
        workspaceLabel={t('SKILL.md 精修编辑器', 'SKILL.md Editor')}
        registryLabel={t('本体技能管理列表', 'Skills Registry')}
        count={skills.length}
        testIdPrefix="skills"
        rightActions={
          <Button
            type="button"
            variant="accent" size="sm"
            onClick={handleRequestCompile}
          >
            {t('编译当前工程 SKILL.md', 'Compile Current Project SKILL.md')}
          </Button>
        }
      />

      {pageMode === 'REGISTRY' ? (
        <RegistryTable<GeneratedSkill>
          testId="skills-registry-table"
          title={t('渐进式业务本体技能中心 (SKILL.md Registry)', 'Ontology Skills Registry')}
          subtitle={t(
            '管理由 11 模型自动编译或手工精修的 Agent SKILL.md 资产',
            'Manage compiled and custom-refined SKILL.md artifacts',
          )}
          rows={skills}
          getRowKey={(s) => s.id}
          activeRowKey={activeSkill?.id}
          matchesSearch={(s, q) =>
            s.name.toLowerCase().includes(q) ||
            s.slug.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
          }
          primaryActionLabel={t('编译当前工程 SKILL.md', 'Compile SKILL.md')}
          onPrimaryAction={handleRequestCompile}
          onRowClick={(s) => {
            setSelectedSkillId(s.id);
            setPageMode('WORKSPACE');
          }}
          columns={[
            {
              key: 'name',
              header: t('技能名称 / Slug', 'Skill Name'),
              render: (s) => (
                <div>
                  <div className="flex items-center gap-1.5 font-semibold text-ink">
                    <span>{s.name}</span>
                    {s.isCustomRefined && (
                      <span className="filter-status-progress rounded-full px-2 py-0.2 text-[10px]">
                        {t('已手工精修', 'Custom Refined')}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-ink-3">{s.slug}</div>
                </div>
              ),
            },
            {
              key: 'version',
              header: t('版本', 'Version'),
              width: '100px',
              render: (s) => <span className="badge badge-ok">v{s.version}</span>,
            },
            {
              key: 'actions',
              header: t('操作', 'Actions'),
              align: 'right',
              render: (s) => (
                <div
                  className="inline-flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      setSelectedSkillId(s.id);
                      setPageMode('WORKSPACE');
                    }}
                  >
                    {t('编辑', 'Edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-red"
                    onClick={() => setDeletingSkill(s)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      ) : activeSkill ? (
        <div className="space-y-3">
          <div className="card flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {skills.length > 1 && (
                <select
                  className="select"
                  style={{ width: 260 }}
                  value={activeSkill.id}
                  onChange={(e) => setSelectedSkillId(e.target.value)}
                >
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.slug})
                    </option>
                  ))}
                </select>
              )}
              <span className="badge badge-accent">{activeSkill.slug}</span>
              <span className="badge badge-ok">v{activeSkill.version}</span>
              {activeSkill.isCustomRefined && (
                <span className="badge badge-warn">
                  {t('★ 已手工精修 (受覆盖保护)', '★ Custom Refined')}
                </span>
              )}
            </div>
            <div className="text-[12px] text-ink-3">{activeSkill.description}</div>
          </div>

          <TiptapMarkdownEditor
            title={`${activeSkill.slug}/SKILL.md`}
            value={skillDraft}
            onChange={setSkillDraft}
            onSave={handleSaveRefinedSkill}
            saveLabel={t('保存精修版 SKILL.md', 'Save Refined SKILL.md')}
            downloadFilename={`${activeSkill.slug}-SKILL.md`}
            minHeight={460}
          />
        </div>
      ) : (
        <div className="card py-10 text-center text-ink-3">
          {t('当前暂无生成的本体技能，点击右上角编译生成。', 'No skills generated yet.')}
        </div>
      )}

      <ConfirmDialog
        open={confirmOverwriteOpen}
        danger
        title={t('覆盖手工精修版 SKILL.md 确认', 'Overwrite Custom-Refined SKILL.md?')}
        description={t(
          '当前工程的 SKILL.md 包含手工精修内容（isCustomRefined）。重新从 11 模型编译将覆盖手工修改，是否继续？',
          'This SKILL.md has manual refinements. Re-compiling from the 11-model AST will overwrite your manual edits. Proceed?',
        )}
        confirmLabel={t('确认重新编译并覆盖', 'Overwrite & Re-compile')}
        onClose={() => setConfirmOverwriteOpen(false)}
        onConfirm={() => void executeCompileSkill()}
      />

      <ConfirmDialog
        open={Boolean(deletingSkill)}
        danger
        title={t('删除本体技能包', 'Delete Ontology Skill')}
        description={
          deletingSkill
            ? t(`确认删除技能「${deletingSkill.name}」吗？`, `Delete "${deletingSkill.name}"?`)
            : ''
        }
        onClose={() => setDeletingSkill(null)}
        onConfirm={() => void handleDeleteSkillConfirm()}
      />
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
            <Button
              type="button"
              variant="accent" size="md"
              disabled={publishingId === app.id}
              onClick={() => handlePublishApp(app.id)}
            >
              {publishingId === app.id
                ? t('正在执行 4A 核验...', 'Running 4A Gate...')
                : t('执行 4A 门禁核验并发布新版本', 'Run 4A Gate & Publish Release')}
            </Button>
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
