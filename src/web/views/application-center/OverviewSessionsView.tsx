import { useState } from 'react';
import {
  Copy,
  Edit3,
  FolderKanban,
  History,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type {
  ProjectSnapshot,
  ProjectSummary,
} from '../../../packages/workspace-store/index.js';
import {
  apiCloneProject,
  apiCreateProjectSnapshot,
  apiDeleteProject,
  apiDeleteProjectSnapshot,
  apiRestoreProjectSnapshot,
  apiUpdateProjectMeta,
  getProjectLifecycleState,
  useWorkbenchStore,
} from '../../api.js';
import {
  Button,
  ConfirmDialog,
  RegistryTable,
} from '../../components/beautifui/index.js';
import { usePreferences, type NavViewId } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

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
  const [newTemplate, setNewTemplate] = useState<'CONTRACT' | 'MFT' | 'EMPTY'>('EMPTY');

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
  const lifecycle = getProjectLifecycleState(data);
  const snapshotsForModal: ProjectSnapshot[] = snapshotProj
    ? (data.projectSnapshots ?? []).filter((s) => s.projectId === snapshotProj.id)
    : [];

  const pipelineSteps: {
    step: string;
    labelZh: string;
    labelEn: string;
    meta: string;
    ready: boolean;
    isNext: boolean;
    targetView: NavViewId;
  }[] = [
    {
      step: '1',
      labelZh: '1.需求探索',
      labelEn: '1. Req Explore',
      meta: lifecycle.hasExploration
        ? `${lifecycle.explorationCount} ${t('会话', 'Sessions')}`
        : t('待开始', 'Not Started'),
      ready: lifecycle.hasExploration,
      isNext: lifecycle.nextStep.step === 1,
      targetView: 'app-req-explore',
    },
    {
      step: '2',
      labelZh: '2.需求规格书',
      labelEn: '2. SRS Spec',
      meta: lifecycle.hasSrsDoc
        ? `${lifecycle.srsDocCount} ${t('份文档', 'Docs')}`
        : t('待合成', 'Pending'),
      ready: lifecycle.hasSrsDoc,
      isNext: lifecycle.nextStep.step === 2,
      targetView: 'app-req-docs',
    },
    {
      step: '3',
      labelZh: '3.界面原型(MU)',
      labelEn: '3. Prototype (MU)',
      meta: data.confirmedPrototypeRevision
        ? `${data.confirmedPrototypeRevision.revision.extractedScreenCount} ${t('屏幕', 'Screens')}`
        : data.prototypes.length > 0
          ? t('草稿待确认', 'Draft Unconfirmed')
          : t('待生成', 'Pending'),
      ready: Boolean(data.confirmedPrototypeRevision),
      isNext: lifecycle.nextStep.step === 3,
      targetView: 'app-prototype',
    },
    {
      step: '4',
      labelZh: '4.11模型本体',
      labelEn: '4. 11-Model Ontology',
      meta: lifecycle.hasOntology
        ? `${active.validation.presentModels.length}/11 Models`
        : t('待推导', 'Pending'),
      ready: lifecycle.hasOntology,
      isNext: lifecycle.nextStep.step === 4,
      targetView: 'app-ontology',
    },
    {
      step: '5',
      labelZh: '5.四层装配与开发包',
      labelEn: '5. 4-Layer Dev Pkg',
      meta:
        lifecycle.projectApps.length > 0
          ? `${lifecycle.projectApps.length} ${t('个应用', 'Apps')}`
          : t('待组装', 'Pending'),
      ready: lifecycle.projectApps.length > 0,
      isNext: lifecycle.nextStep.step === 5 && lifecycle.projectApps.length === 0,
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
    <div className="flex flex-col gap-4">
      {/* 4 KPI Cards */}
      <div className="grid grid-cols-4 gap-3"
      >
        <div className="card">
          <div className="text-[11.5px] text-muted-foreground">
            {t('当前激活本体工程', 'Active Ontology Project')}
          </div>
          <div className="font-title text-[18px] font-semibold mt-1">
            {active.name}
          </div>
          <div className="mt-1.5">
            <span className="badge badge-accent">{active.code}</span>{' '}
            <span className={`badge ${lifecycle.hasOntology ? 'badge-ok' : 'badge-warn'}`}>
              {lifecycle.hasOntology
                ? `${active.validation.presentModels.length}/11 ${t('模型就绪', 'Models Ready')}`
                : t('本体待前置推导', 'Ontology Pending')}
            </span>
          </div>
        </div>

        <div className="card">
          <div className="text-[11.5px] text-muted-foreground">
            {t('两级一致性校验门禁', 'Two-Tier Validation Gate')}
          </div>
          <div className="font-title text-[18px] font-semibold mt-1">
            {!lifecycle.hasOntology
              ? t('尚未进入本体阶段', 'Pre-Ontology Stage')
              : active.validation.errorCount === 0
                ? t('0 一致性错误', '0 Consistency Errors')
                : `${active.validation.errorCount} Errors`}
          </div>
          <div className="mt-1.5">
            <span className="badge badge-ok">Tier 1: Strict</span>{' '}
            <span className="badge badge-warn">
              {lifecycle.hasOntology
                ? `Tier 2: ${active.validation.warningCount} Warnings`
                : t('随上游推进生成', 'Generated progressively')}
            </span>
          </div>
        </div>

        <div className="card">
          <div className="text-[11.5px] text-muted-foreground">
            {t('四层架构资产与当前工程应用', '4-Layer Assets & Project Apps')}
          </div>
          <div className="font-title text-[18px] font-semibold mt-1">
            {data.fourLayerAssets.length} {t('项标准资产', 'Assets')} ·{' '}
            {lifecycle.projectApps.length} {t('个本工程应用', 'Project Apps')}
          </div>
          <div className="mt-1.5">
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
          <div className="text-[11.5px] text-muted-foreground">
            {t('活跃智能体推理网关', 'Active Agent LLM Gateway')}
          </div>
          <div className="font-title text-[18px] font-semibold mt-1">
            {data.systemSettings.mockLlmMode
              ? 'Mock Demo Engine'
              : ((data.llmProviders.find((p) => p.enabled) ?? data.llmProviders[0])
                  ?.defaultModel ?? 'auto/glm-5.3-flash')}
          </div>
          <div className="mt-1.5">
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
                '研发流水线',
                'End-to-End Application Ontology Lifecycle Pipeline',
              )}
            </h3>
          </div>
          <span className="badge badge-accent">{active.domain}</span>
        </div>

        <div className="grid grid-cols-5 gap-2.5"
        >
          {pipelineSteps.map((st, idx) => (
            <div
              key={st.step}
              className={cn(
                'p-[10px_12px] rounded-sm border flex flex-col justify-between gap-2 transition-colors',
                st.isNext
                  ? 'border-primary bg-card shadow-xs'
                  : st.ready
                    ? 'border-border bg-muted'
                    : 'border-border bg-muted opacity-80',
              )}
            >
              <div className="flex justify-between items-center">
                <strong className="text-[13px]">{t(st.labelZh, st.labelEn)}</strong>
                {idx < pipelineSteps.length - 1 && (
                  <span className="text-muted-foreground font-mono">→</span>
                )}
              </div>
              <div className="flex justify-between items-center gap-1.5">
                <span className={`badge ${st.ready ? 'badge-ok' : 'badge-warn'}`}>{st.meta}</span>
                <Button
                  type="button"
                  variant={st.isNext || st.ready ? 'accent' : 'secondary'}
                  size="sm"
                  onClick={() => onNavigate(st.targetView)}
                >
                  {st.isNext ? t('去推进', 'Start') : t('进入', 'Open')} →
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ontology Project Management Hub Registry Table */}
      <RegistryTable<ProjectSummary>
        testId="project-hub-registry"
        title={t('本体工程', 'Ontology Project Management Hub')}
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
              <span className="font-mono text-[12.5px] font-semibold text-foreground">{p.code}</span>
            ),
          },
          {
            key: 'name',
            header: t('工程名称与说明', 'Project Name'),
            render: (p) => (
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <FolderKanban size={13.5} className="text-primary" />
                  <span>{p.name}</span>
                  {p.id === active.id && (
                    <span className="filter-status-done rounded-full px-2 py-0.2 text-[10.5px] font-semibold">
                      {t('当前激活', 'Active')}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11.5px] text-faint-foreground">{p.description}</div>
              </div>
            ),
          },
          {
            key: 'domain',
            header: t('业务领域 / 中心', 'Domain / Center'),
            width: '180px',
            render: (p) => (
              <div className="space-y-1">
                <div className="text-[12.5px] text-foreground">{p.domain}</div>
                <span className="filter-status-accent inline-block rounded-full px-2 py-0.2 font-mono text-[10.5px]">
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
              <span
                className={cn(
                  'inline-block rounded-full px-2.5 py-0.5 text-[11.5px] whitespace-nowrap',
                  p.currentStage > 0 ? 'filter-status-done' : 'filter-status-progress',
                )}
              >
                {p.currentStage > 0
                  ? `${p.currentStage}/11 ${t('模型', 'models')}`
                  : t('待推导 (0/11)', 'Pending (0/11)')}
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
                    className="text-destructive hover:bg-destructive-soft hover:text-destructive"
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
          setNewTemplate('EMPTY');
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
            <label className="form-label">{t('初始化方式', 'Initialization Mode')}</label>
            <select
              className="select"
              value={newTemplate}
              onChange={(e) =>
                setNewTemplate(e.target.value as 'CONTRACT' | 'MFT' | 'EMPTY')
              }
            >
              <option value="EMPTY">
                {t(
                  '从零渐进式生成（推荐：初始不预置任何模型，随需求探索与原型逐步生成）',
                  'Progressive Clean Slate (Recommended: zero preloaded models; generated step-by-step)',
                )}
              </option>
              <option value="CONTRACT">
                {t(
                  '[演示参考模板] 合同全生命周期 CLM（直接填入 11 个合同样例模型）',
                  '[Demo Reference] Contract Lifecycle CLM (preloads 11 sample contract models)',
                )}
              </option>
              <option value="MFT">
                {t(
                  '[演示参考模板] 企业文件安全传输 MFT（直接填入存量萃取样例模型）',
                  '[Demo Reference] Enterprise MFT (preloads legacy extraction sample models)',
                )}
              </option>
            </select>
            {newTemplate !== 'EMPTY' && (
              <div className="mt-1.5 rounded-sm border border-border bg-muted px-2.5 py-2 text-[11.5px] text-foreground-soft">
                {t(
                  '注意：您选择了【演示参考模板】，创建后会立即填入样例系统的全部本体模型与 YAML 文件。如果您正在研发自己的新业务系统（如门店、ERP、电商等），请切换回第一项「从零渐进式生成」以免产生歧义。',
                  'Note: Demo templates preload sample ontology models immediately. Choose "Progressive Clean Slate" for your own new business project to avoid sample data confusion.',
                )}
              </div>
            )}
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
            <div className="rounded-card border border-border bg-muted/50 p-3 space-y-2">
              <div className="text-[12.5px] font-semibold text-foreground">
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
                <div className="py-4 text-center text-[12.5px] text-faint-foreground">
                  {t('当前工程暂无历史快照', 'No snapshots yet for this project')}
                </div>
              ) : (
                snapshotsForModal.map((snap) => (
                  <div
                    key={snap.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">{snap.label}</div>
                      <div className="text-[11.5px] text-faint-foreground">
                        {snap.presentModels.length}/11 Models · {snap.errorCount} Errors ·{' '}
                        {snap.createdAt.slice(0, 19).replace('T', ' ')}
                      </div>
                      {snap.note && (
                        <div className="text-[11.5px] text-foreground-soft">{snap.note}</div>
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
                        className="text-destructive"
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
