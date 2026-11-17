import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Code2,
  Copy,
  Edit3,
  Eye,
  FileCode,
  FolderKanban,
  GitBranch,
  History,
  LayoutList,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
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
  RequirementDoc,
  PrototypeRevision,
  TechnologyProfile,
} from '../../packages/workspace-store/index.js';
import {
  apiCloneProject,
  apiConfirmPrototypeRevision,
  apiCompileDevPackage,
  apiCreateProjectSnapshot,
  apiDeleteProject,
  apiDeleteProjectSnapshot,
  apiDeleteResource,
  apiListPrototypes,
  apiPostJson,
  apiPutJson,
  apiRestoreProjectSnapshot,
  apiUpdateProjectMeta,
  getProjectLifecycleState,
  triggerBrowserDownload,
  useWorkbenchStore,
} from '../api.js';
import { useAgentPanelStore } from '../components/agent/agentPanelStore.js';
import { resolveActiveVisionCapability } from '../components/agent/VisionAttachmentControls.js';
import {
  Button,
  CodeBlock,
  ConfirmDialog,
  RegistryTable,
} from '../components/beautifui/index.js';
import {
  PrototypeCanvasStage,
  runImportPrototypeHtml,
  type PrototypeCanvasStageProps,
} from '../components/prototype/PrototypeCanvasStage.js';
import { decideDesignBriefForMe } from '../components/prototype/DesignBriefAndStyleTile.js';
import { PrototypeCoDesignStudio } from '../components/prototype/PrototypeCoDesignStudio.js';
import { ConfirmRevisionMuDiffModal } from '../components/prototype/PrototypeRevisionHistory.js';
import {
  toRefinementSelections,
  type PrototypeSelectionTarget,
  type PrototypeVisualAnnotation,
} from '../components/prototype/PrototypeVisualInspector.js';
import { PrototypePostRunBanner } from '../components/prototype/SelectionAttachmentStrip.js';
import {
  ingestSelectionTargetAsAttachment,
  resolveLiveRunningPrototypeAnchor,
  resolvePostRunPrototypeReview,
  revertPostRunToPreviousRevision,
  submitPrototypeComposerTurnWithSelections,
  upgradeSelectionAttachmentCrop,
  usePrototypeSelectionStore,
} from '../components/prototype/prototypeSelectionStore.js';
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
            'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12.5px] font-medium cursor-pointer transition-colors',
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
            'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[12.5px] font-medium cursor-pointer transition-colors',
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
  tagEn: '[AI Auto-Completed]' | '[Pending]' | '[Confirmed]';
  badgeClass: 'badge-accent' | 'badge-warn' | 'badge-ok';
  categoryLabelZh: string;
  categoryLabelEn: string;
  body: string;
} {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed.startsWith('[AI自动补全]') || lower.startsWith('[ai auto-completed]')) {
    const prefixLen = trimmed.startsWith('[AI自动补全]')
      ? '[AI自动补全]'.length
      : '[AI Auto-Completed]'.length;
    return {
      tag: '[AI自动补全]',
      tagEn: '[AI Auto-Completed]',
      badgeClass: 'badge-accent',
      categoryLabelZh: 'A类默认补全',
      categoryLabelEn: 'Class-A Auto',
      body: trimmed.slice(prefixLen).trim(),
    };
  }
  if (
    trimmed.startsWith('[待确认]') ||
    lower.startsWith('[pending]') ||
    lower.startsWith('[open]')
  ) {
    const prefixLen = trimmed.startsWith('[待确认]')
      ? '[待确认]'.length
      : lower.startsWith('[pending]')
        ? '[Pending]'.length
        : '[Open]'.length;
    return {
      tag: '[待确认]',
      tagEn: '[Pending]',
      badgeClass: 'badge-warn',
      categoryLabelZh: 'B类待确认',
      categoryLabelEn: 'Class-B Pending',
      body: trimmed.slice(prefixLen).trim(),
    };
  }
  if (trimmed.startsWith('[已确认]') || lower.startsWith('[confirmed]')) {
    const prefixLen = trimmed.startsWith('[已确认]')
      ? '[已确认]'.length
      : '[Confirmed]'.length;
    return {
      tag: '[已确认]',
      tagEn: '[Confirmed]',
      badgeClass: 'badge-ok',
      categoryLabelZh: 'B类已收敛',
      categoryLabelEn: 'Class-B Confirmed',
      body: trimmed.slice(prefixLen).trim(),
    };
  }
  return {
    tag: '[已确认]',
    tagEn: '[Confirmed]',
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
          <div className="font-serif text-[18px] font-semibold mt-1">
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
          <div className="font-serif text-[18px] font-semibold mt-1">
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
          <div className="font-serif text-[18px] font-semibold mt-1">
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
          <div className="font-serif text-[18px] font-semibold mt-1">
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
                'p-[10px_12px] rounded-[6px] border flex flex-col justify-between gap-2 transition-colors',
                st.isNext
                  ? 'border-accent bg-surface shadow-2xs'
                  : st.ready
                    ? 'border-line bg-inset'
                    : 'border-line bg-inset opacity-80',
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
              <span className="font-mono text-[12.5px] font-semibold text-ink">{p.code}</span>
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
                    <span className="filter-status-done rounded-full px-2 py-0.2 text-[10.5px] font-semibold">
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
                <div className="text-[12.5px] text-ink">{p.domain}</div>
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
              <div className="mt-1.5 rounded-[5px] border border-line bg-inset px-2.5 py-2 text-[11.5px] text-ink-2">
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
            <div className="rounded-card border border-line bg-inset/50 p-3 space-y-2">
              <div className="text-[12.5px] font-semibold text-ink">
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
                <div className="py-4 text-center text-[12.5px] text-ink-3">
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
                      <div className="text-[11.5px] text-ink-3">
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

interface NormalizedAggregateSignal {
  key: string;
  title: string;
  englishCode?: string;
  detail?: string;
}

function parseAndDedupeAggregates(rawItems: string[]): NormalizedAggregateSignal[] {
  const byKey = new Map<string, NormalizedAggregateSignal>();

  for (const raw of rawItems) {
    let cleaned = raw
      .trim()
      .replace(/^(AGG候选|AGG|M1)\s*[:：\-·]\s*/i, '')
      .replace(/\s*(\[候选\]|\(候选\)|（候选）)\s*$/g, '')
      .trim();
    if (!cleaned) continue;

    // Extract trailing parenthetical description, e.g. "门店 Store (单店经营，预留多店扩展)"
    let detail: string | undefined;
    const parenMatch = /^(.*?)\s*[\(（]([^()（）]+)[\)）]\s*$/.exec(cleaned);
    if (parenMatch && parenMatch[1]?.trim()) {
      cleaned = parenMatch[1].trim();
      const note = parenMatch[2]?.trim();
      if (note && note !== '候选') {
        detail = note;
      }
    }

    // Separate bilingual title + English identifier, e.g. "员工账号 EmployeeAccount"
    let title = cleaned;
    let englishCode: string | undefined;
    const biMatch = /^([^\x00-\x7F/·\s]+(?:[/·][^\x00-\x7F/·\s]+)*)\s+([A-Za-z][A-Za-z0-9_]*)$/.exec(
      cleaned,
    );
    if (biMatch) {
      title = biMatch[1]!.trim();
      englishCode = biMatch[2]!.trim();
    }

    // Canonicalize primary entity noun so repeated refinements across turns merge cleanly
    const canonicalKey = title
      .toLowerCase()
      .replace(/\s+/g, '')
      .split(/[/、·]/)[0]!;

    const existing = byKey.get(canonicalKey);
    if (!existing) {
      byKey.set(canonicalKey, {
        key: canonicalKey || cleaned,
        title,
        ...(englishCode ? { englishCode } : {}),
        ...(detail ? { detail } : {}),
      });
    } else {
      byKey.set(canonicalKey, {
        key: existing.key,
        title: title.length >= existing.title.length ? title : existing.title,
        englishCode: englishCode || existing.englishCode,
        detail:
          detail && (!existing.detail || detail.length >= existing.detail.length)
            ? detail
            : existing.detail,
      });
    }
  }

  return [...byKey.values()];
}

type ConvergenceTab = 'ALL' | 'DECISIONS' | 'M1' | 'M3';

// ─── 2. Requirement Exploration (需求探索 / Live Streaming + Scoped HITL) ──────
export function RequirementExploreView({
  onNavigate,
}: {
  onNavigate: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const {
    data,
    activeSessionId,
    liveSessionDrafts,
    ensureProjectAgentSession,
    setActiveSessionId,
    startSessionAgentRun,
    startSrsSynthesisRun,
  } = useWorkbenchStore();
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ConvergenceTab>('ALL');
  const [signalFilter, setSignalFilter] = useState('');

  useEffect(() => {
    if (!data) return;
    const exists = data.requirementSessions.some((s) => s.id === selectedSessionId);
    if (!exists) {
      setSelectedSessionId(data.requirementSessions[0]?.id ?? '');
    }
  }, [data?.activeProject.id, data?.requirementSessions, selectedSessionId]);

  // Extract domain signals from unified REQUIREMENT AgentSessions (artifacts + tool traces + HITL answers)
  const extraReqArtifacts = useMemo(() => {
    const aggs = new Set<string>();
    const rules = new Set<string>();
    const decisions = new Set<string>();
    const openQuestions = new Set<string>();

    for (const sess of data?.agentSessions ?? []) {
      if (sess.projectId !== data?.activeProject.id || sess.agentKind !== 'REQUIREMENT') {
        continue;
      }
      for (const m of sess.messages) {
        for (const art of m.artifacts ?? []) {
          if (art.kind === 'REQUIREMENT_HINTS') {
            art.aggregates.forEach((a) => aggs.add(a));
            art.rules.forEach((r) => rules.add(r));
            art.decisions?.forEach((d) => decisions.add(d));
            art.openQuestions.forEach((q) => openQuestions.add(q));
          }
        }
        for (const tc of m.toolCalls ?? []) {
          if (tc.toolName === 'record_requirement_insights' && tc.arguments) {
            const args = tc.arguments;
            if (Array.isArray(args.discoveredAggregates)) {
              args.discoveredAggregates.forEach((a) => aggs.add(String(a)));
            }
            if (Array.isArray(args.discoveredRules)) {
              args.discoveredRules.forEach((r) => rules.add(String(r)));
            }
            if (Array.isArray(args.resolvedDecisions)) {
              args.resolvedDecisions.forEach((d) => decisions.add(String(d)));
            }
            if (Array.isArray(args.openQuestions)) {
              args.openQuestions.forEach((q) => openQuestions.add(String(q)));
            }
          }
        }
        if (m.askUser?.answered && (m.askUser.selectedAnswers?.length ?? 0) > 0) {
          decisions.add(
            `${t('[已确认]', '[Confirmed]')} ${m.askUser.header ? `${m.askUser.header}: ` : ''}${m.askUser.selectedAnswers!.join('; ')}`,
          );
        }
      }
    }
    return {
      aggs: [...aggs],
      rules: [...rules],
      decisions: [...decisions],
      openQuestions: [...openQuestions],
    };
  }, [data?.agentSessions, data?.activeProject.id, t]);

  if (!data) return null;
  const sessions = data.requirementSessions;
  const session =
    sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? undefined;

  const normalizedAggs = useMemo(
    () =>
      parseAndDedupeAggregates([
        ...(session?.discoveredAggregates ?? []),
        ...extraReqArtifacts.aggs,
      ]),
    [session?.discoveredAggregates, extraReqArtifacts.aggs],
  );

  const mergedRules = useMemo(
    () => [
      ...new Set([...(session?.discoveredRules ?? []), ...extraReqArtifacts.rules]),
    ],
    [session?.discoveredRules, extraReqArtifacts.rules],
  );

  const mergedDecisions = useMemo(() => {
    const combined = [
      ...new Set([
        ...(session?.resolvedDecisions ?? []),
        ...extraReqArtifacts.decisions,
      ]),
    ];
    // Append unresolved open questions tagged as [待确认] if not yet resolved
    for (const q of extraReqArtifacts.openQuestions) {
      const cleanQ = q.replace(/^\[[^\]]+\]\s*/, '').trim();
      const alreadyCovered = combined.some((d) => d.includes(cleanQ.slice(0, 12)));
      if (!alreadyCovered) {
        combined.push(q.startsWith('[') ? q : `[待确认] ${q}`);
      }
    }
    return combined;
  }, [
    session?.resolvedDecisions,
    extraReqArtifacts.decisions,
    extraReqArtifacts.openQuestions,
  ]);

  const filterQ = signalFilter.trim().toLowerCase();
  const filteredAggs = useMemo(
    () =>
      filterQ
        ? normalizedAggs.filter(
            (a) =>
              a.title.toLowerCase().includes(filterQ) ||
              (a.englishCode?.toLowerCase().includes(filterQ) ?? false) ||
              (a.detail?.toLowerCase().includes(filterQ) ?? false),
          )
        : normalizedAggs,
    [normalizedAggs, filterQ],
  );

  const filteredRules = useMemo(
    () =>
      filterQ
        ? mergedRules.filter((r) => r.toLowerCase().includes(filterQ))
        : mergedRules,
    [mergedRules, filterQ],
  );

  const filteredDecisions = useMemo(
    () =>
      filterQ
        ? mergedDecisions.filter((d) => d.toLowerCase().includes(filterQ))
        : mergedDecisions,
    [mergedDecisions, filterQ],
  );

  const activeRequirementAgentSessions = useMemo(
    () =>
      (data.agentSessions ?? [])
        .filter(
          (s) =>
            s.projectId === data.activeProject.id &&
            s.agentKind === 'REQUIREMENT' &&
            s.messages.length > 0,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [data.agentSessions, data.activeProject.id],
  );
  const preferredAgentSession =
    activeRequirementAgentSessions.find((s) => s.id === activeSessionId) ??
    activeRequirementAgentSessions[0];

  const totalSignalCount =
    normalizedAggs.length + mergedRules.length + mergedDecisions.length;
  const canSynthesize = Boolean(
    session || preferredAgentSession || totalSignalCount > 0,
  );

  const synthesizingSrs = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === data.activeProject.id &&
      s.agentKind === 'REQUIREMENT' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );

  const handleSynthesizeSrs = () => {
    if (!canSynthesize || synthesizingSrs) return;
    useAgentPanelStore.getState().revealPanel();
    void startSrsSynthesisRun({
      ...(session?.id ? { requirementSessionId: session.id } : {}),
      ...(preferredAgentSession?.id ? { agentSessionId: preferredAgentSession.id } : {}),
    });
  };

  const renderDecisionItem = (dec: string, idx: number) => {
    const parsed = parseDecisionTag(dec);
    return (
      <div
        key={`${idx}-${dec.slice(0, 20)}`}
        className="flex flex-col gap-1 rounded-control border border-line bg-surface px-2.5 py-2 text-[12px] shadow-2xs"
      >
        <div className="flex items-center justify-between gap-1.5">
          <span className={`badge ${parsed.badgeClass}`}>
            {t(parsed.tag, parsed.tagEn)}
          </span>
          <span className="text-[10.5px] text-ink-3">
            {t(parsed.categoryLabelZh, parsed.categoryLabelEn)}
          </span>
        </div>
        <div className="break-words leading-[1.5] text-ink">{parsed.body}</div>
      </div>
    );
  };

  const renderAggregateItem = (agg: NormalizedAggregateSignal) => (
    <div
      key={agg.key}
      className="flex flex-col gap-0.5 rounded-control border border-line bg-surface px-2.5 py-2 text-[12px] shadow-2xs"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-accent-tint px-1.5 py-0.1 font-mono text-[10px] font-semibold text-accent">
          M1
        </span>
        <span className="break-words font-semibold text-ink">{agg.title}</span>
        {agg.englishCode && (
          <code className="rounded bg-inset px-1.5 py-0.1 font-mono text-[10.5px] text-ink-3">
            {agg.englishCode}
          </code>
        )}
      </div>
      {agg.detail && (
        <div className="break-words pl-0.5 text-[11.5px] leading-[1.45] text-ink-3">
          {agg.detail}
        </div>
      )}
    </div>
  );

  const renderRuleItem = (rule: string, idx: number) => {
    const parsed = parseDecisionTag(rule);
    const trimmedRule = rule.trim().toLowerCase();
    const hasExplicitPrefix =
      rule.trim().startsWith('[AI自动补全]') ||
      rule.trim().startsWith('[待确认]') ||
      rule.trim().startsWith('[已确认]') ||
      trimmedRule.startsWith('[ai auto-completed]') ||
      trimmedRule.startsWith('[pending]') ||
      trimmedRule.startsWith('[open]') ||
      trimmedRule.startsWith('[confirmed]');

    return (
      <div
        key={`${idx}-${rule.slice(0, 20)}`}
        className="flex items-start gap-2 rounded-control border border-line bg-surface px-2.5 py-2 text-[12px] leading-[1.5] text-ink shadow-2xs"
      >
        <span className="mt-[2px] inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-green-tint px-1 font-mono text-[10px] font-semibold text-green tabular-nums">
          {idx + 1}
        </span>
        <div className="min-w-0 flex-1 break-words">
          {hasExplicitPrefix && (
            <span
              className={cn(
                'mr-1.5 inline-block rounded px-1.5 py-0.1 text-[10px] font-semibold align-[1px]',
                parsed.badgeClass === 'badge-accent' && 'bg-accent-tint text-accent',
                parsed.badgeClass === 'badge-warn' && 'bg-orange-tint text-orange',
                parsed.badgeClass === 'badge-ok' && 'bg-green-tint text-green',
              )}
            >
              {t(parsed.tag, parsed.tagEn).replace(/^\[|\]$/g, '')}
            </span>
          )}
          <span>{hasExplicitPrefix ? parsed.body : rule}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Compact Top SRS Synthesis Toolbar */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h3 className="card-title">
              {t(
                '需求探索与分级追问',
                'Interactive Requirement Exploration & Scoped HITL',
              )}
            </h3>
            {sessions.length > 1 && (
              <select
                className="select"
                style={{ width: 240 }}
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
            <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-inset/60 px-2.5 py-0.5 font-mono text-[11px] text-ink-2 tabular-nums">
              <span>M1×{normalizedAggs.length}</span>
              <span className="text-ink-3">·</span>
              <span>M3×{mergedRules.length}</span>
              <span className="text-ink-3">·</span>
              <span>
                {t('决策', 'Dec')}×{mergedDecisions.length}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                useAgentPanelStore.getState().revealPanel();
                useAgentPanelStore.getState().setWideMode(true);
              }}
            >
              <Sparkles size={13.5} />
              {t('打开右侧需求探索 Agent →', 'Open Requirement Agent →')}
            </Button>

            <Button
              type="button"
              variant="accent"
              size="sm"
              data-testid="synthesize-srs-btn"
              disabled={!canSynthesize || synthesizingSrs}
              onClick={handleSynthesizeSrs}
            >
              {synthesizingSrs && <Loader2 size={13.5} className="pipeline-spin" aria-hidden="true" />}
              {synthesizingSrs
                ? t('正在合成 9 章节规格书…', 'Synthesizing 9-Chapter SRS…')
                : t(
                    '一键合成 9 章节《软件需求规格说明书》',
                    'Synthesize 9-Chapter SRS Document',
                  )}
            </Button>
          </div>
        </div>
      </div>

      {/* Requirement Discovery Canvas: Quick Starter Prompts + Converged Requirement Signals */}
      <div className="grid gap-3.5 lg:h-[max(540px,calc(100dvh-184px))] lg:grid-cols-[280px_minmax(0,1fr)]">
        <div
          className="card flex flex-col justify-between gap-3"
          data-testid="requirement-explore-context-card"
        >
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-accent" />
              <h4 className="card-title text-[13px]">
                {t('需求探索引导与边界澄清', 'Discovery & Scoped HITL')}
              </h4>
            </div>
            <p className="text-[12px] leading-relaxed text-ink-2">
              {t(
                '需求探索智能体已在右侧 Agent 面板展开（宽幅模式）。A 类常规项自动补全，遇到 B 类模糊业务边界时自动弹出交互式确认卡片。',
                'Requirement Discovery Agent runs in the unified right Agent Panel (Wide Mode). Class-A defaults auto-complete; Class-B ambiguities surface interactive HITL cards.',
              )}
            </p>
            <div className="pt-1 text-[11px] font-semibold text-ink-3">
              {t('一键发起探索示例', 'Quick Discovery Starters')}
            </div>
            <div className="flex flex-col gap-1.5">
              {[
                t(
                  '梳理核心业务单据聚合根、关键状态流转与审批准入红线',
                  'Identify core domain aggregates, lifecycles, and approval gate rules',
                ),
                t(
                  '识别跨系统数据交换、外部准入接口与异常补偿策略',
                  'Clarify cross-system integrations, external credit checks, and compensations',
                ),
                t(
                  '核对当前未决 B 类业务边界并给出推荐决策方案',
                  'Review open Class-B business ambiguities and propose options',
                ),
              ].map((starter, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={synthesizingSrs}
                  onClick={() => {
                    useAgentPanelStore.getState().revealPanel();
                    void (async () => {
                      const targetSess =
                        preferredAgentSession ??
                        (await ensureProjectAgentSession(data.activeProject.id, 'REQUIREMENT', {
                          ...(session?.id ? { targetId: session.id } : {}),
                          title: t('需求探索与边界澄清智能体', 'Requirement Discovery Agent'),
                        }));
                      setActiveSessionId(targetSess.id);
                      await startSessionAgentRun({
                        sessionId: targetSess.id,
                        prompt: starter,
                      });
                    })();
                  }}
                  className="rounded-control border border-line bg-surface-2 px-2.5 py-2 text-left text-[12px] leading-snug text-ink transition-colors hover:border-accent hover:bg-accent-soft cursor-pointer disabled:opacity-50"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-control border border-line bg-inset/45 p-2.5 text-[11.5px] text-ink-3">
            {t(
              `当前项目：${data.activeProject.name} · 已沉淀 ${totalSignalCount} 项结构化信号`,
              `Active Project: ${data.activeProject.name} · ${totalSignalCount} converged signals`,
            )}
          </div>
        </div>

        {/* Bounded Signals Panel: Fixed Height, Internal Contained Scroll, Pinned Footer */}
        <aside
          aria-label={t('已收敛需求要素面板', 'Converged Requirement Signals')}
          className="flex max-h-[680px] min-h-[420px] flex-col overflow-hidden rounded-window border border-line bg-surface shadow-card lg:h-full lg:max-h-none lg:min-h-0"
        >
            {/* Zone 1: Sticky Header + Search + Accessible Tablist */}
            <div className="shrink-0 border-b border-line bg-inset/35">
              <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5 pb-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={13.5} className="text-accent" />
                  <span className="text-[13px] font-semibold text-ink">
                    {t('已识别需求成果', 'Converged Signals')}
                  </span>
                </div>
                <span className="rounded-full bg-accent-tint px-2 py-0.5 font-mono text-[10.5px] font-semibold text-accent tabular-nums">
                  {totalSignalCount} {t('项', 'items')}
                </span>
              </div>

              {totalSignalCount > 5 && (
                <div className="px-3 pb-2">
                  <div className="relative flex items-center">
                    <Search
                      size={12}
                      className="pointer-events-none absolute left-2.5 text-ink-3"
                    />
                    <input
                      type="search"
                      value={signalFilter}
                      onChange={(e) => setSignalFilter(e.target.value)}
                      placeholder={t(
                        '筛选聚合、规则或分级决策…',
                        'Filter aggregates, rules, decisions…',
                      )}
                      className="h-7 w-full rounded-control border border-line bg-surface pl-7 pr-2.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div
                role="tablist"
                aria-label={t('需求识别分类视图', 'Requirement signal categories')}
                className="grid grid-cols-4 px-1.5"
              >
                {(
                  [
                    {
                      id: 'ALL' as const,
                      label: t('概览', 'All'),
                      count: totalSignalCount,
                    },
                    {
                      id: 'DECISIONS' as const,
                      label: t('决策 A/B', 'A/B'),
                      count: filteredDecisions.length,
                    },
                    {
                      id: 'M1' as const,
                      label: t('聚合 M1', 'M1'),
                      count: filteredAggs.length,
                    },
                    {
                      id: 'M3' as const,
                      label: t('规则 M3', 'M3'),
                      count: filteredRules.length,
                    },
                  ] as const
                ).map((tab, idx, allTabs) => (
                  <button
                    key={tab.id}
                    id={`req-signal-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    tabIndex={activeTab === tab.id ? 0 : -1}
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={(e) => {
                      if (
                        e.key !== 'ArrowRight' &&
                        e.key !== 'ArrowLeft' &&
                        e.key !== 'Home' &&
                        e.key !== 'End'
                      ) {
                        return;
                      }
                      e.preventDefault();
                      const nextIdx =
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? allTabs.length - 1
                            : (idx + (e.key === 'ArrowRight' ? 1 : -1) + allTabs.length) %
                              allTabs.length;
                      const nextTab = allTabs[nextIdx]!;
                      setActiveTab(nextTab.id);
                      document.getElementById(`req-signal-tab-${nextTab.id}`)?.focus();
                    }}
                    className="req-tab flex h-8 cursor-pointer items-center justify-center gap-1 px-1.5 text-[11.5px] font-medium text-ink-2 transition-colors hover:text-ink"
                  >
                    <span className="truncate">{tab.label}</span>
                    <span className="rounded-full bg-inset px-1.5 py-0.1 font-mono text-[10px] text-ink-3 tabular-nums">
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Zone 2: Contained Scrollable Body (Never Grows Outer Page!) */}
            <div
              role="tabpanel"
              aria-labelledby={`req-signal-tab-${activeTab}`}
              tabIndex={0}
              className="req-signal-scroller bui-scroller flex-1 min-h-0 space-y-3 overflow-y-auto p-3"
            >
              {totalSignalCount === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
                  <Sparkles size={18} className="mb-2 text-ink-3" />
                  <div className="text-[12.5px] font-medium text-ink-2">
                    {t('暂未沉淀结构化要素', 'No signals extracted yet')}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
                    {t(
                      '在左侧与需求探索智能体对话，识别出的 A/B 决策、M1 聚合根与 M3 业务规则会自动去重归档至此。',
                      'Chat with the Requirement Agent on the left to automatically extract and deduplicate decisions, M1 aggregates, and M3 rules here.',
                    )}
                  </p>
                </div>
              ) : activeTab === 'ALL' ? (
                <>
                  {/* Overview Section 1: A/B Decisions */}
                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                        <CheckCircle2 size={12.5} className="text-accent" />
                        {t('A/B 分级决策清单', 'A/B Decisions')}
                      </span>
                      {filteredDecisions.length > 3 && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('DECISIONS')}
                          className="cursor-pointer text-[11px] font-medium text-accent hover:underline"
                        >
                          {t(`查看全部 ${filteredDecisions.length} 项 →`, `All ${filteredDecisions.length} →`)}
                        </button>
                      )}
                    </div>
                    {filteredDecisions.length === 0 ? (
                      <div className="rounded-control border border-dashed border-line px-2.5 py-2 text-[11.5px] text-ink-3">
                        {t('暂无匹配决策记录', 'No matching decisions')}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {filteredDecisions.slice(0, 3).map(renderDecisionItem)}
                      </div>
                    )}
                  </section>

                  {/* Overview Section 2: Deduplicated M1 Aggregates */}
                  <section className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                        <Boxes size={12.5} className="text-accent" />
                        {t('已识别领域聚合根 (M1)', 'Discovered Aggregates (M1)')}
                      </span>
                      {filteredAggs.length > 5 && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('M1')}
                          className="cursor-pointer text-[11px] font-medium text-accent hover:underline"
                        >
                          {t(`查看全部 ${filteredAggs.length} 个 →`, `All ${filteredAggs.length} →`)}
                        </button>
                      )}
                    </div>
                    {filteredAggs.length === 0 ? (
                      <div className="rounded-control border border-dashed border-line px-2.5 py-2 text-[11.5px] text-ink-3">
                        {t('暂无匹配领域聚合根', 'No matching aggregates')}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {filteredAggs.slice(0, 5).map(renderAggregateItem)}
                      </div>
                    )}
                  </section>

                  {/* Overview Section 3: M3 Business Rules */}
                  <section className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                        <GitBranch size={12.5} className="text-green" />
                        {t('已收敛业务规则 (M3)', 'Discovered Rules (M3)')}
                      </span>
                      {filteredRules.length > 4 && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('M3')}
                          className="cursor-pointer text-[11px] font-medium text-accent hover:underline"
                        >
                          {t(`查看全部 ${filteredRules.length} 条 →`, `All ${filteredRules.length} →`)}
                        </button>
                      )}
                    </div>
                    {filteredRules.length === 0 ? (
                      <div className="rounded-control border border-dashed border-line px-2.5 py-2 text-[11.5px] text-ink-3">
                        {t('暂无匹配业务规则', 'No matching rules')}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {filteredRules.slice(0, 4).map(renderRuleItem)}
                      </div>
                    )}
                  </section>
                </>
              ) : activeTab === 'DECISIONS' ? (
                <div className="space-y-1.5">
                  {filteredDecisions.length === 0 ? (
                    <div className="py-8 text-center text-[12px] text-ink-3">
                      {t('暂无分级决策记录', 'No A/B decisions recorded yet')}
                    </div>
                  ) : (
                    filteredDecisions.map(renderDecisionItem)
                  )}
                </div>
              ) : activeTab === 'M1' ? (
                <div className="space-y-1.5">
                  {filteredAggs.length === 0 ? (
                    <div className="py-8 text-center text-[12px] text-ink-3">
                      {t('暂无已识别聚合根', 'No M1 aggregates discovered yet')}
                    </div>
                  ) : (
                    filteredAggs.map(renderAggregateItem)
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredRules.length === 0 ? (
                    <div className="py-8 text-center text-[12px] text-ink-3">
                      {t('暂无已收敛业务规则', 'No M3 rules discovered yet')}
                    </div>
                  ) : (
                    filteredRules.map(renderRuleItem)
                  )}
                </div>
              )}
            </div>

            {/* Zone 3: Pinned Bottom Next-Step Actions */}
            <div className="shrink-0 space-y-1.5 border-t border-line bg-inset/40 p-2.5">
              <div className="px-0.5 text-[10.5px] font-semibold text-ink-3">
                {t('下一步转化动作', 'Next Actions')}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  onClick={() => onNavigate('app-req-docs')}
                >
                  {t('查看需求说明书 →', 'Open SRS Doc →')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onNavigate('app-ontology')}
                >
                  {t('11 模型工作台 →', '11-Model Suite →')}
                </Button>
              </div>
            </div>
        </aside>
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
  const {
    data,
    activeItemId,
    liveSessionDrafts,
    patchData,
    setActiveItemId,
    setActiveNav,
    showToast,
  } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [docTitle, setDocTitle] = useState<string>('');
  const [docVersion, setDocVersion] = useState<string>('v1.0');
  const [content, setContent] = useState<string>('');
  const [deletingDoc, setDeletingDoc] = useState<RequirementDoc | null>(null);
  const mdUploadRef = useRef<HTMLInputElement | null>(null);

  const docs = data?.requirementDocs ?? [];
  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? docs[0];

  useEffect(() => {
    if (!data || !activeItemId) return;
    const target = data.requirementDocs.find((d) => d.id === activeItemId);
    if (target && target.id !== selectedDocId) {
      setSelectedDocId(target.id);
      setDocTitle(target.title);
      setDocVersion(target.version);
      setContent(target.content);
      setPageMode('WORKSPACE');
    }
  }, [activeItemId, data?.requirementDocs]);

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
      // listRequirementDocs is ordered by updated_at DESC — list[0] is the newest document
      const latest = list[0]!;
      setSelectedDocId(latest.id);
      setDocTitle(latest.title);
      setDocVersion(latest.version);
      setContent(latest.content);
    }
  }, [data?.activeProject.id, data?.requirementDocs]);

  useEffect(() => {
    if (!selectedDoc) return;
    setDocTitle(selectedDoc.title);
    setDocVersion(selectedDoc.version);
    setContent(selectedDoc.content);
  }, [selectedDoc?.id, selectedDoc?.updatedAt]);

  if (!data) return null;

  const generatingProto = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === data.activeProject.id &&
      s.agentKind === 'PROTOTYPE_CO_DESIGN' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );

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
    setActiveItemId(targetDocId ?? null);
    setActiveNav('app-prototype', { itemId: targetDocId ?? null });
    onNavigate?.('app-prototype');
    useAgentPanelStore.getState().revealPanel();
  };

  return (
    <div className="space-y-3">
      <input
        ref={mdUploadRef}
        type="file"
        accept=".md,.txt" className="hidden"
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
              onClick={() => void handleGeneratePrototype()}
            >
              {generatingProto && <Loader2 size={13.5} className="pipeline-spin" aria-hidden="true" />}
              {generatingProto
                ? t('正在生成交互原型…', 'Generating Prototype…')
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
                  <div className="font-mono text-[11.5px] text-ink-3">{d.id}</div>
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

// ─── 4. UI Prototype & MU Sync (界面原型: Briefing Stage <-> Canvas Stage) ─────
export type PrototypeStudioStage = 'BRIEFING' | 'CANVAS';

export function resolvePrototypeStudioStage(
  prototypeCount: number,
  stageOverride: PrototypeStudioStage | null,
): PrototypeStudioStage {
  if (prototypeCount === 0) return 'BRIEFING';
  if (stageOverride === 'BRIEFING') return 'BRIEFING';
  return 'CANVAS';
}

export interface PrototypeStudioViewProps {
  onNavigate?: (view: NavViewId) => void;
  defaultStageOverride?: PrototypeStudioStage | null;
  renderRevisionHistory?: PrototypeCanvasStageProps['renderRevisionHistory'];
  renderConfirmModal?: PrototypeCanvasStageProps['renderConfirmModal'];
}

export function PrototypeStudioView({
  onNavigate,
  defaultStageOverride = null,
  renderRevisionHistory,
  renderConfirmModal,
}: PrototypeStudioViewProps = {}) {
  const { locale, t } = usePreferences();
  const {
    data,
    activeItemId,
    activePrototypeIdByProject,
    liveSessionDrafts,
    patchData,
    showToast,
    setActivePrototypeId,
    startPrototypeBriefGenerationRun,
    startPrototypeBriefRestyleRun,
    startOntologySynthesisRun,
  } = useWorkbenchStore();

  const [stageOverride, setStageOverride] = useState<PrototypeStudioStage | null>(
    defaultStageOverride,
  );
  const [selectedProtoId, setSelectedProtoId] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [refining, setRefining] = useState(false);
  const [revertingPostRun, setRevertingPostRun] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [visualAnnotations, setVisualAnnotations] = useState<PrototypeVisualAnnotation[]>([]);
  const [canvasFocusMode, setCanvasFocusMode] = useState(false);
  const [synthesisSummary, setSynthesisSummary] = useState<{
    modelCount: number;
    errorCount: number;
  } | null>(null);

  const htmlUploadRef = useRef<HTMLInputElement | null>(null);

  const prototypes = data?.prototypes ?? [];
  const confirmedRevision = data?.confirmedPrototypeRevision ?? null;
  const proto = prototypes.find((p) => p.id === selectedProtoId) ?? prototypes[0];
  const docs = data?.requirementDocs ?? [];
  const revisionSignature = prototypes
    .map((p) => `${p.id}:${p.currentRevisionId ?? ''}:${p.revisions?.length ?? 0}`)
    .join('|');
  const pendingBriefTransitionRef = useRef<{ active: boolean; baselineSignature: string }>({
    active: false,
    baselineSignature: '',
  });

  const protoSelectionAttachments = usePrototypeSelectionStore((s) =>
    proto ? s.attachmentsByPrototype[proto.id] : undefined,
  );
  const dismissedRevisionByPrototype = usePrototypeSelectionStore(
    (s) => s.dismissedRevisionByPrototype,
  );
  const flashedRevisionByPrototype = usePrototypeSelectionStore(
    (s) => s.flashedRevisionByPrototype,
  );
  const beforeAfterMode = usePrototypeSelectionStore((s) =>
    proto ? s.getBeforeAfterMode(proto.id, proto.currentRevisionId) : 'AFTER',
  );

  const coDesignSession = useMemo(() => {
    if (!data || !proto) return undefined;
    return data.agentSessions.find(
      (s) =>
        (proto.coDesignSessionId && s.id === proto.coDesignSessionId) ||
        (s.projectId === data.activeProject.id &&
          s.agentKind === 'PROTOTYPE_CO_DESIGN' &&
          s.targetId === proto.id),
    );
  }, [data, proto]);

  const liveDraft = coDesignSession ? liveSessionDrafts[coDesignSession.id] : undefined;
  const activeRunningAnchor = resolveLiveRunningPrototypeAnchor(coDesignSession, liveDraft);
  const postRunReview =
    activeRunningAnchor === null
      ? resolvePostRunPrototypeReview(proto, coDesignSession, dismissedRevisionByPrototype)
      : null;
  const shouldFlashModifiedAnchors = Boolean(
    postRunReview &&
      postRunReview.modifiedAnchors.length > 0 &&
      flashedRevisionByPrototype[postRunReview.prototypeId] !== postRunReview.revision.id,
  );

  useEffect(() => {
    if (!postRunReview || !shouldFlashModifiedAnchors) return;
    const timer = setTimeout(() => {
      usePrototypeSelectionStore
        .getState()
        .markRevisionFlashed(postRunReview.prototypeId, postRunReview.revision.id);
    }, 1800);
    return () => clearTimeout(timer);
  }, [postRunReview?.prototypeId, postRunReview?.revision.id, shouldFlashModifiedAnchors]);

  useEffect(() => {
    setStageOverride(defaultStageOverride);
  }, [defaultStageOverride]);

  // Reset transient studio state when switching projects
  useEffect(() => {
    setSynthesisSummary(null);
    setInspectMode(false);
    setVisualAnnotations([]);
    setCanvasFocusMode(false);
    setStageOverride(defaultStageOverride);
    pendingBriefTransitionRef.current = { active: false, baselineSignature: '' };
  }, [data?.activeProject.id]);

  // Hydrate confirmedRevision from server if bootstrap did not populate it yet
  useEffect(() => {
    if (!data || data.prototypes.length === 0 || data.confirmedPrototypeRevision !== undefined) {
      return;
    }
    let cancelled = false;
    void apiListPrototypes(data.activeProject.id)
      .then((res) => {
        if (cancelled) return;
        patchData({
          prototypes: res.prototypes,
          confirmedPrototypeRevision: res.confirmedRevision,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [data?.activeProject.id, data?.prototypes.length, data?.confirmedPrototypeRevision]);

  // Automatically enter Canvas Stage when a PROTOTYPE_CO_DESIGN brief generation (R1) or restyle (R2+) produces a revision
  useEffect(() => {
    if (!data || !pendingBriefTransitionRef.current.active) return;
    if (
      prototypes.length > 0 &&
      revisionSignature !== pendingBriefTransitionRef.current.baselineSignature
    ) {
      pendingBriefTransitionRef.current = { active: false, baselineSignature: revisionSignature };
      const preferredId =
        activePrototypeIdByProject[data.activeProject.id] || prototypes[0]?.id || '';
      if (preferredId && prototypes.some((p) => p.id === preferredId)) {
        setSelectedProtoId(preferredId);
      } else if (prototypes[0]) {
        setSelectedProtoId(prototypes[0].id);
      }
      setStageOverride('CANVAS');
    }
  }, [
    activePrototypeIdByProject,
    data,
    prototypes,
    revisionSignature,
  ]);

  useEffect(() => {
    if (docs.length === 0) {
      setSelectedDocId('');
      return;
    }
    if (!docs.some((d) => d.id === selectedDocId)) {
      setSelectedDocId(docs[0]!.id);
    }
  }, [data?.activeProject.id, docs]);

  useEffect(() => {
    if (!data || !activeItemId) return;
    const targetProto = data.prototypes.find((p) => p.id === activeItemId);
    if (targetProto) {
      if (targetProto.id !== selectedProtoId) {
        setSelectedProtoId(targetProto.id);
      }
      setStageOverride('CANVAS');
      return;
    }
    const targetDoc = data.requirementDocs.find((d) => d.id === activeItemId);
    if (targetDoc) {
      setSelectedDocId(targetDoc.id);
      setStageOverride('BRIEFING');
    }
  }, [activeItemId, data?.prototypes, data?.requirementDocs]);

  useEffect(() => {
    if (!data) return;
    const list = data.prototypes;
    if (list.length === 0) {
      setSelectedProtoId('');
      return;
    }
    if (!list.some((p) => p.id === selectedProtoId)) {
      setSelectedProtoId(list[0]!.id);
    }
  }, [data?.activeProject.id, data?.prototypes]);

  useEffect(() => {
    setVisualAnnotations([]);
    if (data?.activeProject.id && proto?.id) {
      setActivePrototypeId(data.activeProject.id, proto.id);
    }
  }, [data?.activeProject.id, proto?.id, proto?.updatedAt, proto?.htmlContent, setActivePrototypeId]);

  if (!data) return null;

  const project = data.activeProject;
  const synthesizingOntology = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === project.id &&
      s.agentKind === 'COPILOT' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );
  const isRunningCoDesignSession = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === project.id &&
      s.agentKind === 'PROTOTYPE_CO_DESIGN' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );
  const isBusyProto = refining || isRunningCoDesignSession;
  const visionCapability = resolveActiveVisionCapability(data);

  const currentStage = resolvePrototypeStudioStage(prototypes.length, stageOverride);

  const importHtmlFile = async (file: File) => {
    if (!/\.(html?|xhtml)$/i.test(file.name) && file.type && !file.type.includes('html')) {
      showToast(
        t('请选择 .html 或 .htm 格式的原型文件', 'Please select an .html or .htm prototype file'),
      );
      return;
    }
    const uploadedHtml = await file.text();
    const res = await runImportPrototypeHtml(
      project.id,
      file.name.replace(/\.(html?|xhtml)$/i, '') || '界面原型',
      uploadedHtml,
      locale,
    );
    if (!res) return;
    patchData({
      activeProject: res.project,
      prototypes: res.prototypes,
      confirmedPrototypeRevision: res.confirmedRevision,
    });
    setSelectedProtoId(res.prototype.id);
    setStageOverride('CANVAS');
    showToast(
      t(
        `已导入原型「${res.prototype.name}」（单条初始修订，未修改 MU 模型）`,
        `Imported "${res.prototype.name}" (1 revision created; MU unchanged)`,
      ),
    );
  };

  const handleUploadHtml = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await importHtmlFile(file);
  };

  const handleGenerateNewPrototype = async (options?: { prompt?: string; docId?: string }) => {
    if (refining || isRunningCoDesignSession) return;
    const targetDocId = options?.docId || selectedDocId || undefined;
    const srsDoc = docs.find((d) => d.id === targetDocId) ?? docs[0];
    const promptNote = options?.prompt?.trim() || `${project.name} 交互界面原型`;
    const decided = await decideDesignBriefForMe({
      project,
      ...(srsDoc ? { doc: srsDoc } : {}),
      userFeelNote: promptNote,
      locale,
    });
    pendingBriefTransitionRef.current = {
      active: true,
      baselineSignature: revisionSignature,
    };
    useAgentPanelStore.getState().revealPanel();
    await startPrototypeBriefGenerationRun({
      projectId: project.id,
      prototypeName: `${project.name} 交互界面原型`,
      prompt: promptNote,
      designBrief: decided.brief,
    });
  };

  const handleAddVisualAnnotation = (target: PrototypeSelectionTarget, note: string) => {
    setVisualAnnotations((prev) => {
      const nextIndex = prev.length + 1;
      const id = `ann-${Date.now()}-${nextIndex}`;
      return [...prev, { id, index: nextIndex, target, note }];
    });
  };

  const handleImmediateSelectionRefine = async (
    target: PrototypeSelectionTarget,
    note: string,
  ) => {
    if (!proto || refining) return;
    const selections = toRefinementSelections(visualAnnotations, { target, note });
    if (selections.length === 0 && !note.trim()) return;
    setRefining(true);
    try {
      const pendingAnnotations = visualAnnotations;
      setVisualAnnotations([]);
      setInspectMode(false);
      useAgentPanelStore.getState().revealPanel();
      const visionSupported = resolveActiveVisionCapability(data).visionSupported;
      await submitPrototypeComposerTurnWithSelections({
        projectId: project.id,
        prototypeId: proto.id,
        instruction: note.trim(),
        visionSupported,
        additionalAnnotations: pendingAnnotations,
        immediateDraft: { target, note },
      });
    } finally {
      setRefining(false);
    }
  };

  const handleRevertPostRun = async () => {
    if (!postRunReview || revertingPostRun) return;
    setRevertingPostRun(true);
    try {
      await revertPostRunToPreviousRevision(
        postRunReview.prototypeId,
        postRunReview.previousRevision.id,
      );
    } finally {
      setRevertingPostRun(false);
    }
  };

  const handleSynthesizeOntology = async (_targetPrototypeId?: string) => {
    if (synthesizingOntology) return;
    const confirmedProtoId =
      data.confirmedPrototypeRevision?.prototype.id ??
      data.confirmedPrototypeRevision?.prototypeId;
    if (!confirmedProtoId) {
      showToast(
        t(
          '请先在原型画布点击「确认为当前原型」确认某一修订版本，再推导 11 元模型业务本体',
          'Click "Confirm Current Prototype" first before synthesizing the 11-model ontology',
        ),
      );
      return;
    }
    useAgentPanelStore.getState().revealPanel();
    onNavigate?.('app-ontology');
    const res = await startOntologySynthesisRun({ prototypeId: confirmedProtoId });
    if (res) {
      const updatedProject = useWorkbenchStore.getState().data?.activeProject;
      if (updatedProject) {
        setSynthesisSummary({
          modelCount: Object.values(updatedProject.suite).filter(Boolean).length,
          errorCount: updatedProject.validation.errorCount,
        });
      }
    }
  };

  const statusBanners = synthesisSummary ? (
    <div className="flex items-center justify-between gap-2.5 rounded-[6px] border border-line bg-green-tint p-[8px_12px]">
      <div className="text-[12.5px]">
        <strong>
          {t('11 元模型本体已就绪：', '11-Model Ontology Synthesized: ')}
        </strong>
        {synthesisSummary.modelCount}/11 Models · {synthesisSummary.errorCount}{' '}
        Consistency Errors
      </div>
      <Button
        type="button"
        variant="accent"
        size="sm"
        onClick={() => onNavigate?.('app-ontology')}
      >
        {t('前往 11 模型本体工作台查看 →', 'Open 11-Model Ontology Workbench →')}
      </Button>
    </div>
  ) : null;

  const combinedCanvasAnnotations: PrototypeVisualAnnotation[] = [
    ...(protoSelectionAttachments ?? []).map((att, idx) => ({
      id: att.id,
      index: idx + 1,
      target: att.target,
      note: att.note,
    })),
    ...visualAnnotations.map((ann, idx) => ({
      ...ann,
      index: (protoSelectionAttachments?.length ?? 0) + idx + 1,
    })),
  ];

  const canvasBannerContent =
    postRunReview || statusBanners ? (
      <>
        {postRunReview && (
          <PrototypePostRunBanner
            review={postRunReview}
            mode={beforeAfterMode}
            busy={revertingPostRun}
            onModeChange={(nextMode) =>
              usePrototypeSelectionStore
                .getState()
                .setBeforeAfterMode(postRunReview.prototypeId, nextMode, postRunReview.revision.id)
            }
            onRevert={() => void handleRevertPostRun()}
            onDismiss={() =>
              usePrototypeSelectionStore
                .getState()
                .dismissPostRunReview(postRunReview.prototypeId, postRunReview.revision.id)
            }
          />
        )}
        {statusBanners && <div className="p-2.5">{statusBanners}</div>}
      </>
    ) : null;

  return (
    <div
      className="flex flex-col gap-3"
      style={canvasFocusMode ? { animation: 'none', transform: 'none' } : undefined}
    >
      <input
        ref={htmlUploadRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={handleUploadHtml}
      />

      {currentStage === 'BRIEFING' && statusBanners}

      {currentStage === 'CANVAS' && proto ? (
        <PrototypeCanvasStage
          project={project}
          prototypes={prototypes}
          selectedPrototypeId={proto.id}
          confirmedRevision={confirmedRevision}
          onSelectPrototype={(id) => setSelectedProtoId(id)}
          onPrototypesUpdated={(payload) => {
            patchData({
              prototypes: payload.prototypes,
              ...(payload.confirmedRevision !== undefined
                ? { confirmedPrototypeRevision: payload.confirmedRevision }
                : {}),
              ...(payload.project ? { activeProject: payload.project } : {}),
              ...(payload.agentSessions ? { agentSessions: payload.agentSessions } : {}),
            });
            if (payload.selectedPrototypeId !== undefined) {
              setSelectedProtoId(payload.selectedPrototypeId);
              setActivePrototypeId(project.id, payload.selectedPrototypeId);
              const nextProto = payload.prototypes.find((p) => p.id === payload.selectedPrototypeId);
              if (nextProto?.coDesignSessionId) {
                useWorkbenchStore.getState().setActiveSessionId(nextProto.coDesignSessionId);
              }
            }
          }}
          onBackToBrief={() => {
            setCanvasFocusMode(false);
            setStageOverride('BRIEFING');
          }}
          onNotify={showToast}
          onSynthesizeOntology={(prototypeId) => void handleSynthesizeOntology(prototypeId)}
          synthesizingOntology={synthesizingOntology}
          inspectMode={inspectMode}
          onInspectModeChange={setInspectMode}
          showInlineInspectorPopover={false}
          onSelectTarget={(target, crop) => {
            useAgentPanelStore.getState().revealPanel();
            void ingestSelectionTargetAsAttachment(proto.id, target, { crop: crop ?? null });
          }}
          onSelectionCropUpgrade={(cssSelector, crop) => {
            void upgradeSelectionAttachmentCrop(proto.id, cssSelector, crop);
          }}
          annotations={combinedCanvasAnnotations}
          onAddAnnotation={handleAddVisualAnnotation}
          onApplyImmediate={(target, note) => void handleImmediateSelectionRefine(target, note)}
          activeRunningAnchor={activeRunningAnchor}
          flashedAnchors={
            shouldFlashModifiedAnchors && postRunReview ? postRunReview.modifiedAnchors : []
          }
          flashKey={postRunReview?.revision.id ?? null}
          htmlOverride={
            postRunReview && beforeAfterMode === 'BEFORE'
              ? postRunReview.previousRevision.htmlContent
              : null
          }
          busy={isBusyProto || Boolean(activeRunningAnchor)}
          focusMode={canvasFocusMode}
          onFocusModeChange={setCanvasFocusMode}
          canvasBannerSlot={canvasBannerContent}
          {...(renderRevisionHistory ? { renderRevisionHistory } : {})}
          {...(renderConfirmModal ? { renderConfirmModal } : {})}
        />
      ) : (
        <PrototypeCoDesignStudio
          project={project}
          docs={docs}
          selectedDocId={selectedDocId}
          onSelectDocId={setSelectedDocId}
          prototypes={prototypes}
          {...(prototypes.length > 0 && proto ? { activePrototype: proto } : {})}
          visionSupported={visionCapability.visionSupported}
          {...(visionCapability.providerLabel
            ? { visionProviderLabel: visionCapability.providerLabel }
            : {})}
          {...(onNavigate ? { onOpenLlmCenter: () => onNavigate('llm-center') } : {})}
          onConfirmGenerateBrief={async ({ brief, compiledPrompt, prototypeName, images }) => {
            pendingBriefTransitionRef.current = {
              active: true,
              baselineSignature: revisionSignature,
            };
            await startPrototypeBriefGenerationRun({
              projectId: project.id,
              prototypeName,
              prompt: compiledPrompt,
              designBrief: brief,
              images,
            });
          }}
          onConfirmRestyleBrief={async ({ prototypeId, brief, compiledPrompt, images }) => {
            pendingBriefTransitionRef.current = {
              active: true,
              baselineSignature: revisionSignature,
            };
            await startPrototypeBriefRestyleRun({
              projectId: project.id,
              prototypeId,
              prompt: compiledPrompt,
              designBrief: brief,
              images,
            });
          }}
          onGenerateWithAi={async (compiledPrompt, docId) => {
            await handleGenerateNewPrototype({ prompt: compiledPrompt, docId });
          }}
          {...(prototypes.length > 0
            ? { onBackToCanvas: () => setStageOverride('CANVAS') }
            : {})}
          onImportHtmlClick={() => htmlUploadRef.current?.click()}
          isBusyProto={isBusyProto}
        />
      )}
    </div>
  );
}

// ─── 5. Model Files & OWL / Skill / MCP Export (模型文件) ─────────────────────
export function ModelFilesView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
} = {}) {
  const { t } = usePreferences();
  const { data, patchData, saveSuiteWithUndo, showToast } = useWorkbenchStore();
  const [selectedFile, setSelectedFile] = useState<'MANIFEST' | ModelCode>('M1');
  const [owlPreview, setOwlPreview] = useState<string | null>(null);
  const [owlFileName, setOwlFileName] = useState<string>('ontology.owl');
  const [importErrors, setImportErrors] = useState<{ model: ModelCode; message: string }[]>([]);
  const yamlImportRef = useRef<HTMLInputElement | null>(null);

  if (!data) return null;
  const project = data.activeProject;
  const lifecycle = getProjectLifecycleState(data);
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
    <div className="flex flex-col gap-3.5">
      <input
        ref={yamlImportRef}
        type="file"
        multiple
        accept=".yaml,.yml,.json"
        className="hidden"
        onChange={handleImportYamlFiles}
      />

      {lifecycle.hasForeignDemoTemplate && (
        <div
          className="card flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft, var(--inset))' }}
        >
          <div className="text-[12.5px] text-ink max-w-[680px]">
            <strong>
              {t(
                `提示：当前模型文件来自预置的「${lifecycle.foreignTemplateNameZh}」示例模板`,
                `Notice: Showing preloaded "${lifecycle.foreignTemplateNameEn}" demo model files`,
              )}
            </strong>
            {' — '}
            {t(
              `并非由「${project.name}」生成。点击右侧即可清空示例文件，待完成界面原型后再自动生成本工程专属 YAML。`,
              `Not generated from "${project.name}". Clear the demo template to remove sample YAML files.`,
            )}
          </div>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={async () => {
              await saveSuiteWithUndo({}, 'Cleared preloaded demo template');
              showToast(
                t(
                  '已清空预置示例模板与对应 YAML 模型文件',
                  'Cleared demo template and mirrored YAML files',
                ),
              );
            }}
          >
            {t('清空示例模板文件', 'Clear Demo Files')}
          </Button>
        </div>
      )}

      {!lifecycle.hasOntology ? (
        <div
          className="card py-12 px-6 flex flex-col items-center text-center gap-3 max-w-[680px] mx-auto my-4"
          data-testid="model-files-stage-pending"
        >
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-inset text-accent">
            <Code2 size={20} />
          </div>
          <span className="badge badge-warn">
            {t('尚未到达此阶段 · 暂无模型文件', 'Stage Not Reached · No Model Files Yet')}
          </span>
          <h3 className="font-serif text-[18px] font-semibold text-ink m-0">
            {t(
              `「${project.name}」暂未生成 YAML / OWL 模型文件`,
              `"${project.name}" has no generated YAML / OWL model files yet`,
            )}
          </h3>
          <p className="text-[13px] text-ink-3 max-w-[540px] leading-relaxed m-0">
            {t(
              '这里的 m1~mi.yaml、manifest.json 与 OWL 本体文件并不是需要您提前看懂或手写的配置，而是在完成第 4 步「业务本体」后由系统自动序列化导出的标准工程文件。',
              'YAML, manifest.json, and OWL files are automatically serialized once Step 4 (Business Ontology) is synthesized.',
            )}
          </p>
          <p className="text-[12.5px] text-ink-2 bg-inset border border-line rounded-[6px] px-3.5 py-2 m-0">
            {t(lifecycle.nextStep.hintZh, lifecycle.nextStep.hintEn)}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
            {onNavigate && (
              <Button
                type="button"
                variant="accent"
                size="md"
                onClick={() => onNavigate(lifecycle.nextStep.targetView)}
              >
                {t(lifecycle.nextStep.labelZh, lifecycle.nextStep.labelEn)}
                <ArrowRight size={14} />
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => yamlImportRef.current?.click()}
            >
              <Upload size={14} />
              {t('从外部导入已有 YAML 文件', 'Import Existing YAML Files')}
            </Button>
          </div>
        </div>
      ) : (
        <>
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">
              {t(
                '11 元模型 YAML 文件仓库与多形态导出',
                '11-Model YAML Repository & Multi-Format Export',
              )}
            </h3>
            <div className="text-[12.5px] text-muted-foreground font-mono">
              .onto-cs/model/{project.id}/
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
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
            <strong>{t('YAML 导入解析诊断', 'YAML Import Parse Errors')}</strong>
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={() => setImportErrors([])}
            >
              {t('清除提示', 'Dismiss')}
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {importErrors.map((err, i) => (
              <div key={i} className="font-mono text-[12.5px]">
                <strong>[{err.model}]</strong> {err.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[270px_1fr] gap-3">
        <div className="card" style={{ padding: 8 }}>
          <button
            type="button"
            className={`nav-item ${selectedFile === 'MANIFEST' ? 'active' : ''}`}
            onClick={() => setSelectedFile('MANIFEST')}
          >
            <span className="nav-item-left">
              <span className="font-mono font-semibold">IDX</span>
              <span className="font-mono text-[11.5px]">manifest.json</span>
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
                  <span className="font-mono font-semibold">{item.code}</span>
                  <span className="font-mono text-[11.5px]">{fileName}</span>
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
        </>
      )}

      {owlPreview && (
        <div className="modal-backdrop" onClick={() => setOwlPreview(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">W3C OWL/RDF XML — {project.name}</h3>
              <div className="flex gap-2">
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
              data-testid="owl-xml-preview" className="p-3 bg-inset rounded-[5px] font-mono text-[11.5px] max-h-[420px] overflow-auto"
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
  const {
    data,
    activeItemId,
    liveSessionDrafts,
    patchData,
    showToast,
    startTechArchGenerationRun,
  } = useWorkbenchStore();
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
    technologyProfileId?: string;
    sourcePath?: string;
  } | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState<FourLayerAsset | null>(null);

  const [archName, setArchName] = useState('');
  const [archStackTags, setArchStackTags] = useState(
    'React, Vite, TanStack Router, Zustand, shadcn/ui Base UI, Hono, Drizzle ORM, SQLite, Node.js',
  );
  const [archPrompt, setArchPrompt] = useState('');
  const [startingArch, setStartingArch] = useState(false);

  useEffect(() => {
    if (!data || !activeItemId) return;
    const matched = data.fourLayerAssets.find((a) => a.id === activeItemId);
    if (matched) {
      setFilterLayer(matched.layer);
    }
  }, [activeItemId, data?.fourLayerAssets]);

  if (!data) return null;
  const codingRunning = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === data.activeProject.id &&
      String(s.agentKind) === 'ARCHITECTURE' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );
  const generatingArch = startingArch || codingRunning;
  const list =
    filterLayer === 'ALL'
      ? data.fourLayerAssets
      : data.fourLayerAssets.filter((a) => a.layer === filterLayer);

  const openNewAssetModal = () => {
    const defaultLayer: FourLayerAsset['layer'] =
      filterLayer === 'ALL' ? 'TECH_ARCH' : filterLayer;
    setEditingAsset({
      id: `asset-${defaultLayer.toLowerCase().replaceAll('_', '-')}-${Date.now()}`,
      layer: defaultLayer,
      name: '',
      version: 'v1.0',
      summary: '',
      tagsText: 'Standard, Reusable',
      specMarkdown: '# 架构资产规范说明\n\n## 1. 核心约束\n- 严格遵循 Deep Modules 边界规范\n',
      technologyProfileId: 'profile-react-hono-sqlite-node',
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
      technologyProfileId: asset.technologyProfileId,
      sourcePath: asset.sourcePath,
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
        technologyProfileId: editingAsset.technologyProfileId,
      });
      patchData({ fourLayerAssets: json.fourLayerAssets });
      setEditingAsset(null);
      showToast(t(`已将「${json.asset.name}」保存到仓库源文件`, `Saved "${json.asset.name}" to repository source`));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
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
      technologyProfileId: asset.technologyProfileId,
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
    setStartingArch(true);
    try {
      const stackTags = archStackTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const targetName = archName.trim() || `${data.activeProject.name} 技术架构设计文档`;
      setFilterLayer('TECH_ARCH');
      useAgentPanelStore.getState().revealPanel();
      await startTechArchGenerationRun({
        name: targetName,
        stackTags,
        ...(archPrompt.trim() ? { prompt: archPrompt.trim() } : {}),
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setStartingArch(false);
    }
  };

  const layerLabels: Record<'ALL' | FourLayerAsset['layer'], { zh: string; en: string }> = {
    ALL: { zh: '全部资产 (ALL)', en: 'ALL' },
    UI_UE: { zh: 'UI/UE 设计规范 (UI_UE)', en: 'UI_UE' },
    TECH_FOUNDATION: { zh: '技术底座规范 (TECH_FOUNDATION)', en: 'TECH_FOUNDATION' },
    TECH_ARCH: { zh: '技术架构文档 (TECH_ARCH)', en: 'TECH_ARCH' },
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="card">
        <div className="card-header" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">
              {t(
                '仓库开发规范库',
                'Repository development standards',
              )}
            </h3>
            <div className="text-[length:var(--text-sm)] text-muted-foreground">
              {t(
                '规范源文件随平台代码维护。编辑后写回仓库，已生成的开发包保留原快照。',
                'Standards live with the platform source. Saving writes to repository files; generated packages keep their saved snapshots.',
              )}
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
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
              {t('请架构资产智能体协助编写规范', 'Author standards with the Architecture Asset Agent')}
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
              : t('开始规范编写对话', 'Start standards authoring')}
          </Button>
        </div>

        <div className="form-grid-3">
          <div className="form-field">
              <label className="form-label" htmlFor="architecture-standard-name">{t('架构资产名称', 'Architecture Asset Name')}</label>
            <input
                id="architecture-standard-name"
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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {list.map((asset) => (
          <div key={asset.id} className="card min-w-0 flex flex-col gap-2" data-testid={`architecture-asset-${asset.id}`}>
            <div className="card-header" style={{ marginBottom: 0 }}>
              <div>
                <span className="badge badge-accent mr-2">
                  {asset.layer}
                </span>
                <strong>{asset.name}</strong>
              </div>
              <div className="flex gap-1.25 items-center">
                <span className="badge badge-ok">{asset.version}</span>
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  aria-label={t(`克隆 ${asset.name}`, `Clone ${asset.name}`)}
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
                  aria-label={t(`删除 ${asset.name}`, `Delete ${asset.name}`)}
                  onClick={() => setDeletingAsset(asset)}
                  title={t('删除资产', 'Delete')}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>

            <div className="text-[length:var(--text-sm)] text-muted-foreground">{asset.summary}</div>
            <div className="rounded-control border border-line bg-inset p-2 text-[length:var(--text-xs)] text-ink-3" data-testid={`asset-source-${asset.id}`}>
              <div className="break-all font-mono">{asset.sourcePath || t('工作区历史资料 · 保存后写入仓库', 'Legacy workspace material · save to write repository source')}</div>
              {asset.sourceRevision && <div className="break-all font-mono mt-1">{asset.sourceRevision}</div>}
              {asset.technologyProfileId && <div className="mt-1">{t('技术方案', 'Technology profile')}: {asset.technologyProfileId}</div>}
            </div>

            {asset.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
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
        <ConfirmDialog open title={t('编辑仓库开发规范', 'Edit repository development standard')}
          size="wide" busy={savingAsset} confirmDisabled={!editingAsset.name.trim() || !editingAsset.specMarkdown.trim()}
          confirmLabel={t('保存到仓库源文件', 'Save to repository source')}
          onConfirm={() => void handleSaveAsset()} onClose={() => setEditingAsset(null)} testId="architecture-standard-editor">
            <div className="flex flex-col gap-2.5">
              <p className="m-0 break-all font-mono text-[length:var(--text-xs)] text-ink-3">{editingAsset.sourcePath ?? `src/packages/architecture-assets/lib/catalog/assets/${editingAsset.id}.json`}</p>
              <div className="form-grid-3">
                <div className="form-field">
                  <label className="form-label" htmlFor="architecture-standard-layer">{t('所属架构层', 'Layer')}</label>
                  <select
                    id="architecture-standard-layer"
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
                  <label className="form-label" htmlFor="architecture-standard-edit-name">{t('资产名称', 'Asset Name')}</label>
                  <input
                    id="architecture-standard-edit-name"
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

              <label className="form-field" htmlFor="architecture-standard-profile">
                <span className="form-label">{t('兼容技术方案', 'Compatible Technology Profile')}</span>
                <select id="architecture-standard-profile" className="select" value={editingAsset.technologyProfileId ?? ''}
                  onChange={(event) => setEditingAsset({ ...editingAsset, technologyProfileId: event.target.value || undefined })}>
                  <option value="">{t('由方案目录明确列出兼容性', 'Compatibility declared in profile catalog')}</option>
                  {((data as typeof data & { technologyProfiles?: TechnologyProfile[] }).technologyProfiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>

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
        </ConfirmDialog>
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
export async function fetchSavedApplicationPackage(appId: string, signal?: AbortSignal): Promise<{
  compiledPackage: CompiledDevelopmentPackage | null;
  stale: boolean;
  inputIssue?: string;
}> {
  const response = await fetch(`/api/applications/${encodeURIComponent(appId)}/package`, { signal });
  const body = await response.json();
  if (response.status === 409 && body.code === 'PACKAGE_NOT_GENERATED') return { compiledPackage: null, stale: false };
  if (!response.ok) throw new Error(body.error || 'Could not load the saved Development Package.');
  if (body.compiledPackage && body.compiledPackage.appId !== appId) throw new Error('Saved package belongs to a different application.');
  return { compiledPackage: body.compiledPackage ?? null, stale: Boolean(body.stale),
    ...(typeof body.inputIssue === 'string' && body.inputIssue ? { inputIssue: body.inputIssue } : {}) };
}

export function ApplicationAssemblyDevView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
} = {}) {
  const { t } = usePreferences();
  const { data, activeItemId, liveSessionDrafts, ensureProjectAgentSession, patchData, setActiveItemId,
    setActiveSessionId, showToast, startSessionAgentRun, switchProject } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedAppId, setSelectedAppId] = useState('');
  const [compiledPkg, setCompiledPkg] = useState<CompiledDevelopmentPackage | null>(null);
  const [packageStale, setPackageStale] = useState(false);
  const [loadingPackage, setLoadingPackage] = useState(false);
  const [packageLoadError, setPackageLoadError] = useState('');
  const [packageInputIssue, setPackageInputIssue] = useState('');
  const [packageReload, setPackageReload] = useState(0);
  const [selectedFilePath, setSelectedFilePath] = useState('AGENTS.md');
  const [pkgPreviewRaw, setPkgPreviewRaw] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [savingInputs, setSavingInputs] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [operationError, setOperationError] = useState('');
  const [previewRevisionId, setPreviewRevisionId] = useState('');
  const [pendingRevision, setPendingRevision] = useState<PrototypeRevision | null>(null);
  const [confirmingRevision, setConfirmingRevision] = useState(false);
  const [newAppOpen, setNewAppOpen] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newProfileId, setNewProfileId] = useState('profile-react-hono-sqlite-node');
  const [creatingApp, setCreatingApp] = useState(false);
  const [deletingApp, setDeletingApp] = useState<AssembledApplication | null>(null);

  const allApps = data?.assembledApplications ?? [];
  const projectApps = allApps.filter((item) => item.projectId === data?.activeProject.id);
  const app = projectApps.find((item) => item.id === selectedAppId) ?? projectApps.find((item) => item.id === activeItemId) ?? projectApps[0];
  const currentAppId = useRef<string | undefined>(app?.id);
  currentAppId.current = app?.id;
  const profiles = (data as (typeof data & { technologyProfiles?: TechnologyProfile[] }))?.technologyProfiles ?? [];
  const profileId = app?.technologyProfileId ?? 'profile-react-hono-sqlite-node';
  const profile = profiles.find((item) => item.id === profileId);
  const sourceKey = JSON.stringify({
    assets: data?.fourLayerAssets.map((asset) => [asset.id, asset.sourceRevision, asset.updatedAt]),
    profiles: profiles.map((item) => [item.id, item.sourceRevision]),
    requirements: data?.requirementDocs.map((doc) => [doc.id, doc.updatedAt]),
    project: data?.activeProject.updatedAt,
    confirmed: data?.confirmedPrototypeRevision?.revisionId,
  });

  useEffect(() => {
    setInstructionsDraft(app?.developmentInstructions ?? '');
    setOperationError('');
  }, [app?.id, app?.developmentInstructions]);

  useEffect(() => {
    setPreviewRevisionId(app?.prototypeRevisionId ?? data?.confirmedPrototypeRevision?.revisionId ?? '');
    setPendingRevision(null);
    if (app) setActiveItemId(app.id);
  }, [app?.id, app?.prototypeRevisionId, data?.confirmedPrototypeRevision?.revisionId, setActiveItemId]);

  useEffect(() => {
    const controller = new AbortController();
    setPackageLoadError('');
    setPackageInputIssue('');
    if (!app) {
      setCompiledPkg(null);
      setPackageStale(false);
      setLoadingPackage(false);
      return () => controller.abort();
    }
    setLoadingPackage(true);
    if (compiledPkg?.appId !== app.id) setCompiledPkg(null);
    void fetchSavedApplicationPackage(app.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setCompiledPkg(result.compiledPackage);
      setPackageStale(result.stale);
      setPackageInputIssue(result.inputIssue ?? '');
      setSelectedFilePath((selected) => result.compiledPackage?.files.some((file) => file.relativePath === selected)
        ? selected : 'AGENTS.md');
    }).catch((error) => {
      if (!controller.signal.aborted) setPackageLoadError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (!controller.signal.aborted) setLoadingPackage(false); });
    return () => controller.abort();
  }, [app?.id, app?.updatedAt, app?.latestPackageSnapshotId, sourceKey, packageReload]);

  if (!data) return null;
  const project = data.activeProject;
  const confirmed = data.confirmedPrototypeRevision;
  const prototype = data.prototypes.find((item) => item.revisions.some((revision) => revision.id === previewRevisionId));
  const previewRevision = prototype?.revisions.find((revision) => revision.id === previewRevisionId);
  const revisions = data.prototypes.flatMap((item) => item.revisions.map((revision) => ({ prototype: item, revision })));
  const boundRevisionId = app?.prototypeRevisionId ?? confirmed?.revisionId;
  const selectedAssets = app ? [app.uiUeAssetId, app.techFoundationAssetId, app.techArchAssetId]
    .map((id) => data.fourLayerAssets.find((asset) => asset.id === id)) : [];
  const compatible = (asset: FourLayerAsset) => Boolean(profile &&
    (profile.compatibleAssetIds.includes(asset.id) || asset.technologyProfileId === profile.id));
  const notesDirty = instructionsDraft !== (app?.developmentInstructions ?? '');
  const recordedBlockers = (app as (AssembledApplication & { developmentBlockers?: string[] }) | undefined)?.developmentBlockers ?? [];
  const diagnostics = [
    ...recordedBlockers.map((blocker) => t(`请解决已记录的冲突：${blocker}`, `Resolve the recorded contradiction: ${blocker}`)),
    ...(data.requirementDocs.length === 0 ? [t('请先保存需求文档。', 'Save a requirements document first.')] : []),
    ...(!confirmed ? [t('请确认一个原型修订并同步 MU。', 'Confirm a prototype revision and sync MU.')] : []),
    ...(confirmed && boundRevisionId && boundRevisionId !== confirmed.revisionId
      ? [t('应用绑定的原型修订尚未确认为工程 UI 来源。', 'The application revision is not the project’s confirmed UI source.')] : []),
    ...(previewRevision && previewRevision.id !== confirmed?.revisionId
      ? [t('当前预览是未确认修订，请确认或返回已确认修订。', 'The preview is unconfirmed. Confirm it or return to the confirmed revision.')] : []),
    ...(project.validation.presentModels.length === 0 ? [t('请先建立本体套件。', 'Create the Ontology Suite first.')] : []),
    ...(!project.validation.valid ? [t('请先修复本体一致性错误。', 'Resolve ontology Consistency Errors.')] : []),
    ...(app && !profile ? [t(`找不到技术方案 ${profileId}。`, `Technology Profile ${profileId} is missing.`)] : []),
    ...(app ? selectedAssets.flatMap((asset, index) => !asset
      ? [t(`第 ${index + 1} 项开发规范不存在，请重新选择。`, `Selected standard ${index + 1} is missing. Select it explicitly.`)]
      : !compatible(asset) ? [t(`规范「${asset.name}」与当前技术方案不兼容。`, `Standard "${asset.name}" is incompatible with this profile.`)] : []) : []),
    ...(notesDirty ? [t('请先保存应用补充说明。', 'Save application instructions first.')] : []),
  ];

  const saveInputs = async (patch: Partial<AssembledApplication>) => {
    if (!app) return;
    setSavingInputs(true);
    setOperationError('');
    try {
      const result = await apiPostJson<{ application: AssembledApplication; assembledApplications: AssembledApplication[] }>(
        '/api/applications', { ...app, ...patch });
      patchData({ assembledApplications: result.assembledApplications });
      if (compiledPkg) setPackageStale(true);
      return result.application;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally { setSavingInputs(false); }
  };

  const createApplication = async () => {
    const selectedProfile = profiles.find((item) => item.id === newProfileId);
    if (!selectedProfile || creatingApp) return;
    setCreatingApp(true);
    setOperationError('');
    try {
      const result = await apiPostJson<{ application: AssembledApplication; assembledApplications: AssembledApplication[] }>(
        '/api/applications', {
          id: `app-${Date.now().toString(36)}`, name: newAppName.trim() || `${project.name} Application`,
          projectId: project.id, technologyProfileId: selectedProfile.id,
          ...selectedProfile.defaultAssetIds,
          ...(confirmed ? { prototypeRevisionId: confirmed.revisionId } : {}),
          developmentInstructions: '', status: 'ASSEMBLED', agentDevLogs: [],
        });
      patchData({ assembledApplications: result.assembledApplications });
      setSelectedAppId(result.application.id);
      setPageMode('WORKSPACE');
      setNewAppOpen(false);
      setNewAppName('');
      showToast(t('已创建应用开发规格', 'Created application specification'));
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
    finally { setCreatingApp(false); }
  };

  const chooseRevision = (revisionId: string) => {
    setPreviewRevisionId(revisionId);
    const revision = revisions.find((item) => item.revision.id === revisionId)?.revision;
    if (!revision) return;
    if (revision.id !== confirmed?.revisionId) setPendingRevision(revision);
    else if (app && revision.id !== app.prototypeRevisionId) void saveInputs({ prototypeRevisionId: revision.id });
  };

  const confirmRevision = async (revisionId: string) => {
    setConfirmingRevision(true);
    setOperationError('');
    try {
      const result = await apiConfirmPrototypeRevision(project.id, revisionId);
      patchData({ activeProject: result.project, prototypes: result.prototypes, confirmedPrototypeRevision: result.confirmedRevision });
      setPendingRevision(null);
      if (app) await saveInputs({ prototypeRevisionId: result.confirmedRevision.revisionId });
      showToast(t('已确认修订并同步 MU', 'Confirmed revision and synchronized MU'));
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
    finally { setConfirmingRevision(false); }
  };

  const generatePackage = async () => {
    if (!app || generating || diagnostics.length > 0) return;
    setGenerating(true);
    setOperationError('');
    try {
      const result = await apiCompileDevPackage(app.id);
      if (currentAppId.current === app.id) {
        setCompiledPkg(result.compiledPackage);
        setPackageStale(false);
        setPackageInputIssue('');
        setSelectedFilePath('AGENTS.md');
      }
      patchData({ assembledApplications: result.assembledApplications });
      showToast(t(`已生成包含 ${result.compiledPackage.files.length} 个文件的开发包快照`, `Generated a package snapshot with ${result.compiledPackage.files.length} files`));
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
    finally { setGenerating(false); }
  };

  const downloadPackage = async () => {
    if (!app || !compiledPkg || downloadingZip) return;
    setDownloadingZip(true);
    try {
      const id = String(compiledPkg.manifestJson.snapshotId ?? app.latestPackageSnapshotId ?? '');
      if (!id) throw new Error(t('已保存开发包缺少快照标识，请重新生成。', 'The saved package has no snapshot identity. Generate it again.'));
      const response = await fetch(`/api/applications/${encodeURIComponent(app.id)}/package.zip?snapshotId=${encodeURIComponent(id)}`);
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'ZIP download failed'); }
      triggerBrowserDownload(`${app.id}-development-package.zip`, await response.blob(), 'application/zip');
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
    finally { setDownloadingZip(false); }
  };

  const openApplicationAgent = async (prompt?: string) => {
    if (!app) return;
    setActiveItemId(app.id);
    useAgentPanelStore.getState().revealPanel();
    try {
      const session = await ensureProjectAgentSession(project.id, 'CODING', {
        targetId: app.id, title: `${app.name} · ${t('应用开发智能体', 'Application Development Agent')}`,
      });
      setActiveSessionId(session.id);
      if (prompt) await startSessionAgentRun({ sessionId: session.id, prompt });
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
  };

  const appAgentRunning = Boolean(app && data.agentSessions.some((session) =>
    session.projectId === project.id && session.agentKind === 'CODING' && session.targetId === app.id &&
    (session.status === 'RUNNING' || liveSessionDrafts[session.id])));
  const activeFile = compiledPkg?.files.find((file) => file.relativePath === selectedFilePath) ??
    compiledPkg?.files.find((file) => file.relativePath === 'AGENTS.md');
  const snapshotId = String(compiledPkg?.manifestJson.snapshotId ?? app?.latestPackageSnapshotId ?? '');

  const openPackageReference = (href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!activeFile || !compiledPkg || !href) return;
    const packageOrigin = 'https://development-package.invalid';
    let target: URL;
    try { target = new URL(href, `${packageOrigin}/${activeFile.relativePath}`); }
    catch { return; }
    if (target.origin !== packageOrigin) return;
    event.preventDefault();
    let filePath: string;
    try { filePath = decodeURIComponent(target.pathname.slice(1)); }
    catch { setOperationError(t('开发包引用路径无效。', 'The package reference path is invalid.')); return; }
    if (!compiledPkg.files.some((file) => file.relativePath === filePath)) {
      setOperationError(t(`开发包中缺少引用文件：${filePath}`, `Referenced file is missing from this package: ${filePath}`));
      return;
    }
    setSelectedFilePath(filePath);
    setPkgPreviewRaw(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3.5" data-testid="application-development-workflow">
      <div className="card flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="card-title">{t('应用开发 · 准备可执行的开发规格', 'Application development · Prepare the implementation specification')}</h3>
          <p className="mt-1 mb-0 max-w-[780px] text-[length:var(--text-sm)] leading-relaxed text-ink-3">{t(
            '确认业务与界面来源，选择工程规范，将完整规格交给编码智能体实施。',
            'Confirm business and UI sources, select engineering standards, and prepare the complete handoff for a coding agent.')}</p>
        </div>
        <Button onClick={() => setNewAppOpen(true)} disabled={generating || profiles.length === 0} data-testid="create-application-btn">
          <Plus data-icon="inline-start" />{t('新建应用', 'New application')}
        </Button>
      </div>
      <ViewModeHeader mode={pageMode} onChange={setPageMode}
        workspaceLabel={t('当前工程开发流程', 'Project development workflow')}
        registryLabel={t('高级：应用注册表', 'Advanced: application registry')}
        count={allApps.length} testIdPrefix="app-assembly" />
      {operationError && <div role="alert" className="rounded-card border border-red/30 bg-red-tint p-3 text-[length:var(--text-sm)] text-red" data-testid="application-operation-error">{operationError}</div>}
      {pageMode === 'REGISTRY' ? (
        <RegistryTable<AssembledApplication> testId="assembled-app-registry" title={t('应用规格注册表', 'Application specifications')}
          rows={allApps} getRowKey={(item) => item.id} activeRowKey={app?.id}
          matchesSearch={(item, query) => item.name.toLowerCase().includes(query)}
          onRowClick={(item) => { void (async () => { if (item.projectId !== project.id) await switchProject(item.projectId); setSelectedAppId(item.id); setPageMode('WORKSPACE'); })(); }}
          columns={[
            { key: 'name', header: t('应用', 'Application'), render: (item) => <strong>{item.name}</strong> },
            { key: 'project', header: t('本体工程', 'Ontology Project'), render: (item) => data.projects.find((entry) => entry.id === item.projectId)?.name ?? item.projectId },
            { key: 'profile', header: t('技术方案', 'Technology Profile'), render: (item) => item.technologyProfileId ?? t('沿用默认方案', 'Default profile') },
            { key: 'snapshot', header: t('开发包快照', 'Package Snapshot'), render: (item) => item.latestPackageSnapshotId ?? t('尚未生成', 'Not generated') },
            { key: 'actions', header: t('操作', 'Actions'), align: 'right', render: (item) => <Button variant="danger" size="xs" aria-label={t(`删除 ${item.name}`, `Delete ${item.name}`)} onClick={(event) => { event.stopPropagation(); setDeletingApp(item); }}><Trash2 data-icon="inline-start" /></Button> },
          ]} />
      ) : (<>
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <label className="flex flex-wrap items-center gap-2 text-[length:var(--text-base)] font-semibold" htmlFor="development-application-select">
            {t('当前应用', 'Current application')}
            <select id="development-application-select" className="select max-w-full" value={app?.id ?? ''} disabled={generating || savingInputs} onChange={(event) => setSelectedAppId(event.target.value)} data-testid="development-application-select">
              {!app && <option value="">{t('尚未创建应用', 'No application yet')}</option>}
              {projectApps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {!app && <Button variant="accent" onClick={() => setNewAppOpen(true)} disabled={profiles.length === 0}>{t('为当前工程创建应用', 'Create application for this project')}</Button>}
        </div>

        <section className="card flex min-w-0 flex-col gap-3" data-testid="development-step-confirm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="card-title">1 · {t('确认原型与本体套件', 'Confirm prototype and Ontology Suite')}</h4>
            <span className={`badge ${project.validation.valid && confirmed ? 'badge-ok' : 'badge-warn'}`}>
              {project.validation.presentModels.length}/11 {t('模型', 'models')} · {project.validation.errorCount} {t('错误', 'errors')} · {project.validation.warningCount} {t('阶段提示', 'Stage Warnings')}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="form-field flex-1 min-w-[220px]">
              <label className="form-label" htmlFor="development-prototype-revision">{t('工程原型与历史修订', 'Project prototype and revision')}</label>
              <select id="development-prototype-revision" className="select" value={previewRevisionId} disabled={savingInputs || confirmingRevision || generating} onChange={(event) => chooseRevision(event.target.value)} data-testid="development-prototype-revision">
                <option value="">{t('选择原型修订', 'Select a prototype revision')}</option>
                {revisions.map(({ prototype: entry, revision }) => <option key={revision.id} value={revision.id}>{entry.name} · #{revision.revisionNumber} {revision.title}{revision.id === confirmed?.revisionId ? t(' · 已确认', ' · Confirmed') : ''}</option>)}
              </select>
            </div>
            {previewRevision && previewRevision.id !== confirmed?.revisionId && <Button variant="accent" onClick={() => setPendingRevision(previewRevision)} data-testid="development-confirm-revision-btn">{t('查看 MU 变更并确认', 'Review MU changes and confirm')}</Button>}
            {onNavigate && <Button onClick={() => onNavigate('app-ontology')}>{t('检查本体套件', 'Inspect Ontology Suite')}</Button>}
          </div>
          <p className="m-0 text-[length:var(--text-sm)] text-ink-3">{confirmed
            ? t(`工程已确认：${confirmed.prototype.name} #${confirmed.revision.revisionNumber}。确认其他修订将先展示 MU 变更。`, `Confirmed source: ${confirmed.prototype.name} #${confirmed.revision.revisionNumber}. A different revision requires reviewing its MU changes.`)
            : t('选择修订后先检查 MU 变更；确认后才成为开发包的 UI 来源。', 'Review MU changes before confirmation. Only a confirmed revision becomes a package UI source.')}</p>
          {previewRevision ? <iframe title={t('应用原型修订预览', 'Application prototype revision preview')} srcDoc={previewRevision.htmlContent} sandbox="allow-scripts" className="h-[340px] w-full rounded-card border border-line bg-surface" data-testid="development-prototype-preview" />
            : <div className="rounded-card border border-dashed border-line p-6 text-center text-[length:var(--text-sm)] text-ink-3">{t('选择一个原型修订进行预览。', 'Select a prototype revision to preview.')}{onNavigate && <Button className="ml-2" onClick={() => onNavigate('app-prototype')}>{t('前往界面原型', 'Open prototypes')}</Button>}</div>}
        </section>

        <section className="card flex flex-col gap-3" data-testid="development-step-standards">
          <h4 className="card-title">2 · {t('选择技术方案与开发规范', 'Choose a Technology Profile and standards')}</h4>
          {!app ? <p className="m-0 text-[length:var(--text-sm)] text-ink-3">{t('创建应用后选择技术方案及其兼容规范。', 'Create an application to select its profile and compatible standards.')}</p> : <>
            <label className="form-field" htmlFor="development-profile-select"><span className="form-label">{t('技术方案', 'Technology Profile')}</span>
              <select id="development-profile-select" className="select" value={profileId} disabled={savingInputs || generating} data-testid="development-profile-select" onChange={(event) => {
                const next = profiles.find((item) => item.id === event.target.value);
                if (next) void saveInputs({ technologyProfileId: next.id, ...next.defaultAssetIds });
              }}>
                {!profile && <option value={profileId}>{t(`缺失：${profileId}`, `Missing: ${profileId}`)}</option>}
                {profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.version}</option>)}
              </select>
            </label>
            {profile && <div className="rounded-card border border-line bg-inset/45 p-3 text-[length:var(--text-sm)] leading-relaxed text-ink-2">
              <p className="mt-0 mb-2">{profile.summary}</p>
              <div>{profile.frontend.join(' · ')}</div><div>{profile.backend.join(' · ')} · {profile.persistence.join(' · ')}</div><div>{profile.deployment.join(' · ')}</div>
              <p className="mt-2 mb-0 text-ink-3">{t('以已确认原型的视觉设计为准。选择不同方案会改用该方案明确指定的默认规范。', 'The confirmed prototype governs visual design. Changing profiles selects that profile’s explicit default standards.')}</p>
            </div>}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {([
                { key: 'uiUeAssetId', layer: 'UI_UE', zh: 'UI 实现规范', en: 'UI implementation standard' },
                { key: 'techFoundationAssetId', layer: 'TECH_FOUNDATION', zh: '技术底座规范', en: 'Engineering foundation' },
                { key: 'techArchAssetId', layer: 'TECH_ARCH', zh: '技术架构规范', en: 'Architecture standard' },
              ] as const).map((field) => {
                const available = data.fourLayerAssets.filter((asset) => asset.layer === field.layer && compatible(asset));
                return <label key={field.key} className="form-field" htmlFor={`development-${field.key}`}><span className="form-label">{t(field.zh, field.en)}</span>
                  <select id={`development-${field.key}`} className="select" value={app[field.key]} disabled={savingInputs || generating} onChange={(event) => void saveInputs({ [field.key]: event.target.value })} data-testid={`development-${field.key}`}>
                    {!available.some((asset) => asset.id === app[field.key]) && <option value={app[field.key]}>{t('当前规范缺失或不兼容，请选择', 'Current standard is missing or incompatible')}</option>}
                    {available.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.version}</option>)}
                  </select>
                </label>;
              })}
            </div>
          </>}
        </section>

        <section className="card flex min-w-0 flex-col gap-3" data-testid="development-step-origins">
          <h4 className="card-title">3 · {t('检查输入来源与应用说明', 'Inspect input origins and application instructions')}</h4>
          {recordedBlockers.length > 0 && <div role="alert" className="rounded-card border border-red/30 bg-red-tint p-3 text-[length:var(--text-sm)] text-red" data-testid="application-recorded-blockers">
            <strong>{t('需要解决的输入冲突', 'Input contradictions to resolve')}</strong>
            <ul className="mb-0 mt-1 list-disc pl-4">{recordedBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
          </div>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-[length:var(--text-sm)]">
            <div className="rounded-card border border-line bg-inset/35 p-3"><strong>{t('业务来源', 'Business sources')}</strong>
              <div className="mt-1">{project.name} · {project.code}</div>
              {data.requirementDocs.map((doc) => <div key={doc.id} className="mt-1 text-ink-3">{doc.title} · {doc.updatedAt}</div>)}
              <div className="mt-1 font-mono text-ink-3">{t('本体套件', 'Ontology Suite')}: {project.id} · {project.updatedAt}</div>
              <div className="mt-1 break-all font-mono text-ink-3">{t('已绑定 UI 修订', 'Bound UI revision')}: {boundRevisionId ?? t('尚未确认', 'Not confirmed')}</div>
            </div>
            <div className="rounded-card border border-line bg-inset/35 p-3"><strong>{t('技术方案来源', 'Technology Profile source')}</strong>
              <div className="mt-1">{profile?.name ?? t('尚未选择', 'Not selected')}</div>
              <div className="mt-1 break-all font-mono text-ink-3">{profile?.sourcePath}</div><div className="mt-1 break-all font-mono text-ink-3">{profile?.sourceRevision}</div>
            </div>
          </div>
          {selectedAssets.map((asset, index) => asset && <details key={asset.id} className="rounded-card border border-line p-3" data-testid={`development-standard-origin-${index}`}>
            <summary className="cursor-pointer text-[length:var(--text-sm)] font-medium">{asset.name} · {asset.version}</summary>
            <div className="my-2 break-all font-mono text-[length:var(--text-xs)] text-ink-3">{asset.sourcePath ?? t('工作区历史资料；请在规范库保存为仓库规范。', 'Legacy workspace material; save it to repository source in the standards library.')}<br />{asset.sourceRevision}</div>
            <MarkdownRenderer content={asset.specMarkdown} />
          </details>)}
          {app && <div className="form-field">
            <label className="form-label" htmlFor="application-development-instructions">{t('当前应用的补充实施说明', 'Application-specific implementation instructions')}</label>
            <textarea id="application-development-instructions" className="textarea min-h-[100px]" value={instructionsDraft} disabled={savingInputs || generating} onChange={(event) => setInstructionsDraft(event.target.value)} data-testid="application-development-instructions" placeholder={t('记录当前应用的范围、约束或需要编码智能体关注的决策。', 'Record application scope, constraints, and decisions for the coding agent.')} />
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[length:var(--text-xs)] text-ink-3">{t('应用说明进入下一份开发包；共享规范在架构资产库维护。', 'Instructions enter the next package. Maintain shared standards in the architecture library.')}</span>
              <Button disabled={!notesDirty || savingInputs || generating} onClick={() => void saveInputs({ developmentInstructions: instructionsDraft })} data-testid="save-application-instructions-btn">{savingInputs ? t('正在保存…', 'Saving…') : t('保存应用说明', 'Save instructions')}</Button></div>
          </div>}
        </section>

        <section className="card flex min-w-0 flex-col gap-3" data-testid="development-step-generate">
          <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="card-title">4 · {t('生成开发资料包', 'Generate the Development Package')}</h4>
            <div className="flex flex-wrap items-center gap-2">
              <Button data-testid="download-package-zip-btn" disabled={!compiledPkg || compiledPkg.appId !== app?.id || downloadingZip || loadingPackage} onClick={() => void downloadPackage()}>{downloadingZip ? t('正在下载…', 'Downloading…') : t('下载已保存快照 .zip', 'Download saved snapshot .zip')}</Button>
              <Button variant="accent" data-testid="compile-dev-package-btn" disabled={!app || diagnostics.length > 0 || generating || savingInputs || confirmingRevision} onClick={() => void generatePackage()}>{generating ? t('正在生成…', 'Generating…') : compiledPkg ? t('重新生成开发包', 'Regenerate package') : t('生成开发包', 'Generate package')}</Button>
            </div>
          </div>
          <p className="m-0 text-[length:var(--text-sm)] text-ink-3">{t('生成会校验并固定当前输入，产出 AGENTS.md、实施顺序、验收条件和原始参考资料。', 'Generation validates and fixes the inputs into AGENTS.md, implementation order, acceptance criteria, and original references.')}</p>
          {diagnostics.length > 0 && <ul className="m-0 list-disc pl-5 text-[length:var(--text-sm)] leading-relaxed text-ink-3" data-testid="development-input-diagnostics">{diagnostics.map((message) => <li key={message}>{message}</li>)}</ul>}
          {loadingPackage && <div role="status" className="text-[length:var(--text-sm)] text-ink-3">{t('正在读取已保存的开发包…', 'Loading the saved package…')}</div>}
          {packageLoadError && <div role="alert" className="flex flex-wrap items-center gap-2 text-[length:var(--text-sm)] text-red">{packageLoadError}<Button size="xs" onClick={() => setPackageReload((value) => value + 1)}>{t('重试', 'Retry')}</Button></div>}
          {packageInputIssue && <div role="alert" className="text-[length:var(--text-sm)] text-red" data-testid="saved-package-input-issue">{packageInputIssue}</div>}
          {compiledPkg && <>
            <div className="flex flex-wrap items-center gap-2 text-[length:var(--text-xs)]" data-testid="saved-package-snapshot">
              <span className={`badge ${packageStale || notesDirty ? 'badge-warn' : 'badge-ok'}`} data-testid="package-stale-indicator">{packageStale || notesDirty ? t('输入已变化，等待重新生成', 'Inputs changed · regenerate to update') : t('已保存开发包快照', 'Saved package snapshot')}</span>
              <span className="break-all font-mono text-ink-3">{snapshotId} · {compiledPkg.compiledAt}</span>
            </div>
            {(packageStale || notesDirty) && <p className="m-0 text-[length:var(--text-sm)] text-ink-3">{t('下方预览与下载仍使用同一份已保存快照。重新生成后才会包含输入更新。', 'Preview and download use the same saved snapshot. Generate again to include input changes.')}</p>}
            <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-3" data-testid="compiled-package-inspector">
              <nav aria-label={t('开发包文件', 'Development Package files')} className="flex max-h-[520px] flex-col gap-1 overflow-auto rounded-card border border-line p-2">
                {compiledPkg.files.map((file) => <button type="button" key={file.relativePath} className={cn('nav-item text-left', activeFile?.relativePath === file.relativePath && 'active')} aria-current={activeFile?.relativePath === file.relativePath ? 'page' : undefined} onClick={() => setSelectedFilePath(file.relativePath)}><span className="break-all font-mono text-[length:var(--text-xs)]">{file.relativePath}</span></button>)}
              </nav>
              <div className="min-w-0 rounded-card border border-line p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><strong className="font-mono text-[length:var(--text-sm)]" data-testid="package-preview-path">{activeFile?.relativePath}</strong>
                  {activeFile?.relativePath.endsWith('.md') && <Button variant="ghost" size="xs" onClick={() => setPkgPreviewRaw((value) => !value)}>{pkgPreviewRaw ? t('排版预览', 'Rendered preview') : t('查看源码', 'View source')}</Button>}</div>
                <div className="max-h-[520px] overflow-auto" data-testid="package-file-preview">{activeFile && (activeFile.relativePath.endsWith('.md') && !pkgPreviewRaw
                  ? <MarkdownRenderer content={activeFile.content} onLinkClick={openPackageReference} />
                  : <CodeBlock code={activeFile.content} language={activeFile.relativePath.split('.').pop() ?? 'text'} filename={activeFile.relativePath} maxHeight={500} />)}</div>
              </div>
            </div>
          </>}
        </section>
        {app && <section className="card flex flex-col gap-3" data-testid="coding-agent-context-card">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="card-title">{t('应用开发智能体', 'Application Development Agent')}</h4><Button onClick={() => void openApplicationAgent()}>{t('打开智能体面板', 'Open Agent Panel')}</Button></div>
          <p className="m-0 text-[length:var(--text-sm)] text-ink-3">{t('检查当前应用的输入、指出缺失或冲突，并完善实施规格。', 'Inspect this application’s inputs, identify gaps or conflicts, and refine its implementation specification.')}</p>
          <div className="flex flex-wrap gap-2">{[
            t('检查当前应用的输入来源，列出缺失内容和明确冲突。', 'Review this application’s input sources and identify missing information or explicit contradictions.'),
            t('结合已确认原型与本体套件，完善当前应用的实施顺序和验收说明。', 'Refine this application’s implementation order and acceptance instructions using its confirmed prototype and Ontology Suite.'),
          ].map((prompt) => <Button key={prompt} disabled={appAgentRunning} onClick={() => void openApplicationAgent(prompt)} className="h-auto whitespace-normal py-2 text-left">{prompt}</Button>)}</div>
        </section>}
      </>)}
      <ConfirmDialog open={newAppOpen} title={t('创建应用开发规格', 'Create an application specification')}
        confirmLabel={t('创建应用', 'Create application')} busy={creatingApp} confirmDisabled={!profiles.some((item) => item.id === newProfileId)}
        onClose={() => setNewAppOpen(false)} onConfirm={() => void createApplication()} testId="create-application-dialog">
        <div className="flex flex-col gap-3">
          <div className="text-[length:var(--text-sm)] text-ink-3">{project.name} · {t('使用当前工程的需求、已确认原型和本体套件。', 'Uses this project’s requirements, confirmed prototype, and Ontology Suite.')}</div>
          <label className="form-field" htmlFor="new-application-name"><span className="form-label">{t('应用名称', 'Application name')}</span><input id="new-application-name" className="input" value={newAppName} onChange={(event) => setNewAppName(event.target.value)} /></label>
          <label className="form-field" htmlFor="new-application-profile"><span className="form-label">{t('技术方案', 'Technology Profile')}</span><select id="new-application-profile" className="select" value={newProfileId} onChange={(event) => setNewProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {operationError && <div role="alert" className="text-[length:var(--text-sm)] text-red">{operationError}</div>}
        </div>
      </ConfirmDialog>
      <ConfirmRevisionMuDiffModal open={Boolean(pendingRevision)} revision={pendingRevision} prototypeName={data.prototypes.find((item) => item.id === pendingRevision?.prototypeId)?.name}
        suite={project.suite} confirmedRevision={confirmed} domain={project.domain} busy={confirmingRevision}
        onClose={() => setPendingRevision(null)} onConfirm={confirmRevision} />
      <ConfirmDialog open={Boolean(deletingApp)} danger title={t('删除应用规格', 'Delete application specification')}
        description={deletingApp ? t(`确认删除「${deletingApp.name}」？`, `Delete "${deletingApp.name}"?`) : ''}
        onClose={() => setDeletingApp(null)} onConfirm={() => { if (!deletingApp) return; void apiDeleteResource<{ assembledApplications: AssembledApplication[] }>(`/api/applications/${encodeURIComponent(deletingApp.id)}`).then((result) => { patchData({ assembledApplications: result.assembledApplications }); setDeletingApp(null); }).catch((error) => setOperationError(error instanceof Error ? error.message : String(error))); }} />
    </div>
  );
}


// ─── 8. Skills & Application Publish Views ───────────────────────────────────
export function OntologySkillsView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
} = {}) {
  const { t } = usePreferences();
  const { data, patchData, showToast, switchProject } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');
  const [skillDraft, setSkillDraft] = useState<string>('');
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<GeneratedSkill | null>(null);

  const skills = data?.generatedSkills ?? [];
  const projectSkills = skills.filter((s) => s.projectId === data?.activeProject.id);
  const activeSkill =
    projectSkills.find((s) => s.id === selectedSkillId) ?? projectSkills[0];

  useEffect(() => {
    if (projectSkills.length === 0) {
      setSelectedSkillId('');
      return;
    }
    if (!projectSkills.some((s) => s.id === selectedSkillId)) {
      setSelectedSkillId(projectSkills[0]!.id);
    }
  }, [projectSkills.length, selectedSkillId, data?.activeProject.id]);

  useEffect(() => {
    setSkillDraft(activeSkill?.skillMarkdown ?? '');
  }, [activeSkill?.id, activeSkill?.updatedAt, activeSkill?.skillMarkdown]);

  if (!data) return null;
  const lifecycle = getProjectLifecycleState(data);

  const targetCompileProjectId = data.activeProject.id;

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
        ...activeSkill,
        skillMarkdown: mdToSave,
        isCustomRefined: true,
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
            disabled={!lifecycle.hasOntology}
            onClick={handleRequestCompile}
          >
            {t('编译当前工程 SKILL.md', 'Compile Current Project SKILL.md')}
          </Button>
        }
      />

      {pageMode === 'REGISTRY' ? (
        <RegistryTable<GeneratedSkill>
          testId="skills-registry-table"
          title={t('业务本体技能', 'Ontology Skills Registry')}
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
          onRowClick={async (s) => {
            if (s.projectId !== data.activeProject.id) {
              await switchProject(s.projectId);
            }
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
                      <span className="filter-status-progress rounded-full px-2 py-0.2 text-[10.5px]">
                        {t('已手工精修', 'Custom Refined')}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[11.5px] text-ink-3">{s.slug}</div>
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
                    onClick={async () => {
                      if (s.projectId !== data.activeProject.id) {
                        await switchProject(s.projectId);
                      }
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
              {projectSkills.length > 1 && (
                <select
                  className="select"
                  style={{ width: 260 }}
                  value={activeSkill.id}
                  onChange={(e) => setSelectedSkillId(e.target.value)}
                >
                  {projectSkills.map((s) => (
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
            <div className="text-[12.5px] text-ink-3">{activeSkill.description}</div>
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
        <div className="card py-12 px-6 flex flex-col items-center text-center gap-3 max-w-[680px] mx-auto my-4">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-inset text-accent">
            <Sparkles size={20} />
          </div>
          <span className={`badge ${lifecycle.hasOntology ? 'badge-ok' : 'badge-warn'}`}>
            {lifecycle.hasOntology
              ? t('本体已就绪 · 可编译技能包', 'Ontology Ready · Ready to Compile')
              : t('尚未到达此阶段 · 暂无本体技能', 'Stage Not Reached · No Skill Yet')}
          </span>
          <h3 className="font-serif text-[18px] font-semibold text-ink m-0">
            {t(
              `「${data.activeProject.name}」尚未生成 SKILL.md 技能包`,
              `"${data.activeProject.name}" has no compiled SKILL.md yet`,
            )}
          </h3>
          <p className="text-[13px] text-ink-3 max-w-[540px] leading-relaxed m-0">
            {lifecycle.hasOntology
              ? t(
                  '点击下方按钮，系统将根据当前工程的 11 元模型自动编译生成供智能体调用的渐进式 SKILL.md 技能包。',
                  'Compile a progressive-disclosure SKILL.md directly from your 11-model ontology.',
                )
              : t(
                  'SKILL.md 技能包是由当前工程第 4 步「业务本体」自动编译导出的资产。当前工程尚未生成业务本体，此处不展示其他工程的技能内容。',
                  'SKILL.md is compiled from your Step 4 Business Ontology. Complete upstream stages first.',
                )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
            {lifecycle.hasOntology ? (
              <Button type="button" variant="accent" size="md" onClick={handleRequestCompile}>
                <Sparkles size={14} />
                {t('一键编译生成当前工程 SKILL.md', 'Compile Current Project SKILL.md')}
              </Button>
            ) : (
              onNavigate && (
                <Button
                  type="button"
                  variant="accent"
                  size="md"
                  onClick={() => onNavigate(lifecycle.nextStep.targetView)}
                >
                  {t(lifecycle.nextStep.labelZh, lifecycle.nextStep.labelEn)}
                  <ArrowRight size={14} />
                </Button>
              )
            )}
          </div>
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

function ApplicationPackageDeliveryCard({ app, sourceKey, onNavigate }: {
  app: AssembledApplication;
  sourceKey: string;
  onNavigate?: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const { setActiveItemId } = useWorkbenchStore();
  const [saved, setSaved] = useState<{ compiledPackage: CompiledDevelopmentPackage | null; stale: boolean; inputIssue?: string } | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void fetchSavedApplicationPackage(app.id, controller.signal).then((result) => {
      if (!controller.signal.aborted) setSaved(result);
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => controller.abort();
  }, [app.id, app.latestPackageSnapshotId, app.updatedAt, sourceKey]);
  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      const id = String(saved?.compiledPackage?.manifestJson.snapshotId ?? app.latestPackageSnapshotId ?? '');
      if (!id) throw new Error(t('已保存开发包缺少快照标识，请重新生成。', 'The saved package has no snapshot identity. Generate it again.'));
      const response = await fetch(`/api/applications/${encodeURIComponent(app.id)}/package.zip?snapshotId=${encodeURIComponent(id)}`);
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'ZIP download failed'); }
      triggerBrowserDownload(`${app.id}-development-package.zip`, await response.blob(), 'application/zip');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDownloading(false); }
  };
  return <div className="card flex flex-col gap-3" data-testid={`package-delivery-${app.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="card-title">{app.name}</h4>
      <span className={`badge ${saved?.stale ? 'badge-warn' : saved?.compiledPackage ? 'badge-ok' : 'badge-warn'}`}>
        {saved?.stale ? t('输入已变化', 'Inputs changed') : saved?.compiledPackage ? t('开发包已保存', 'Package saved') : t('等待生成开发包', 'Awaiting package generation')}
      </span>
    </div>
    {saved?.compiledPackage ? <div className="break-all font-mono text-[11.5px] text-ink-3">{String(saved.compiledPackage.manifestJson.snapshotId ?? app.latestPackageSnapshotId ?? '')} · {saved.compiledPackage.compiledAt} · {saved.compiledPackage.files.length} {t('个文件', 'files')}</div>
      : <p className="m-0 text-[12.5px] text-ink-3">{t('在应用开发中确认输入并生成开发资料包。', 'Confirm the inputs and generate a Development Package in application development.')}</p>}
    {saved?.stale && <p className="m-0 text-[12px] text-ink-3">{t('下载保留已保存快照。请在应用开发中重新生成以包含最新输入。', 'Download keeps the saved snapshot. Regenerate in application development to include current inputs.')}</p>}
    {error && <div role="alert" className="text-[12px] text-red">{error}</div>}
    {saved?.inputIssue && <div role="alert" className="text-[12px] text-red">{saved.inputIssue}</div>}
    <div className="flex flex-wrap gap-2">
      {onNavigate && <Button onClick={() => { setActiveItemId(app.id); onNavigate('app-assembly-dev'); }}>{t('检查开发规格', 'Review implementation specification')}</Button>}
      <Button variant="accent" disabled={!saved?.compiledPackage || downloading} onClick={() => void download()}>{downloading ? t('正在下载…', 'Downloading…') : t('下载已保存开发包', 'Download saved package')}</Button>
    </div>
  </div>;
}

export function AppPublishView({ onNavigate }: { onNavigate?: (view: NavViewId) => void } = {}) {
  const { t } = usePreferences();
  const { data } = useWorkbenchStore();
  if (!data) return null;
  const apps = data.assembledApplications.filter((app) => app.projectId === data.activeProject.id);
  const sourceKey = JSON.stringify({
    assets: data.fourLayerAssets.map((asset) => [asset.id, asset.sourceRevision, asset.updatedAt]),
    project: data.activeProject.updatedAt,
    requirements: data.requirementDocs.map((doc) => [doc.id, doc.updatedAt]),
    confirmed: data.confirmedPrototypeRevision?.revisionId,
  });
  return <div className="flex flex-col gap-3" data-testid="development-package-delivery">
    <div className="card"><h3 className="card-title">{t('开发包交付', 'Development Package handoff')}</h3>
      <p className="mt-1 mb-0 text-[length:var(--text-sm)] text-ink-3">{t('将已审阅的实施规格、原型、本体与规范交给编码智能体。', 'Hand the reviewed implementation specification, prototype, ontology, and standards to a coding agent.')}</p>
    </div>
    {apps.length === 0 ? <div className="card flex flex-col items-start gap-3"><p className="m-0 text-[length:var(--text-base)] text-ink-3">{t('当前工程尚未创建应用开发规格。', 'This project has no application specification yet.')}</p>
      {onNavigate && <Button variant="accent" onClick={() => onNavigate('app-assembly-dev')}>{t('前往应用开发', 'Open application development')}</Button>}
    </div> : apps.map((app) => <ApplicationPackageDeliveryCard key={app.id} app={app} sourceKey={sourceKey} onNavigate={onNavigate} />)}
  </div>;
}
