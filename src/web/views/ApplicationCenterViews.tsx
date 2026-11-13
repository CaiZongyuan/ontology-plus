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
} from '../../packages/workspace-store/index.js';
import {
  apiCloneProject,
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
import {
  agentSessionScopeKey,
  useAgentPanelStore,
} from '../components/agent/agentPanelStore.js';
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
  centerSlot,
  rightActions,
}: {
  mode: 'WORKSPACE' | 'REGISTRY';
  onChange: (next: 'WORKSPACE' | 'REGISTRY') => void;
  workspaceLabel: string;
  registryLabel: string;
  count: number;
  testIdPrefix: string;
  /** Identity of the thing being edited (picker, title, version), kept on the same bar as the mode switch. */
  centerSlot?: React.ReactNode;
  rightActions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 overflow-hidden rounded-window border border-line bg-surface px-3.5 py-2 shadow-2xs">
      <div className="inline-flex shrink-0 items-center rounded-[7px] border border-line bg-inset p-0.5">
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
      {rightActions && (
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{rightActions}</div>
      )}
      {centerSlot && (
        <div className="-mx-3.5 -mb-2 flex min-w-0 basis-[calc(100%+1.75rem)] flex-wrap items-center gap-2 border-t border-line-soft bg-inset/40 px-3.5 py-2">
          {centerSlot}
        </div>
      )}
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

type ConvergenceTab = 'DECISIONS' | 'M1' | 'M3';

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
    startSrsSynthesisRun,
  } = useWorkbenchStore();
  const agentPanelOpen = useAgentPanelStore((s) => s.open);
  const rememberedSessionByScope = useAgentPanelStore((s) => s.sessionByScope);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ConvergenceTab>('DECISIONS');
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

  // SRS synthesis reads the conversation it runs in, so it goes to the one on screen
  // unless that one is still empty; then the most recent conversation with content.
  const preferredAgentSession = useMemo(() => {
    const candidates = (data.agentSessions ?? [])
      .filter((s) => s.projectId === data.activeProject.id && s.agentKind === 'REQUIREMENT')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const rememberedId =
      rememberedSessionByScope[agentSessionScopeKey(data.activeProject.id, 'REQUIREMENT')];
    const onScreen =
      candidates.find((s) => s.id === activeSessionId) ??
      candidates.find((s) => s.id === rememberedId);
    if (onScreen && onScreen.messages.length > 0) return onScreen;
    return candidates.find((s) => s.messages.length > 0);
  }, [data.agentSessions, data.activeProject.id, activeSessionId, rememberedSessionByScope]);

  const totalSignalCount =
    normalizedAggs.length + mergedRules.length + mergedDecisions.length;
  const pendingDecisionCount = mergedDecisions.filter(
    (d) => parseDecisionTag(d).badgeClass === 'badge-warn',
  ).length;
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

  const openConversation = () => {
    useAgentPanelStore.getState().revealPanel();
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>('[data-testid="agent-panel-composer-input"]')
        ?.focus();
    });
  };

  const renderDecisionItem = (dec: string, idx: number) => {
    const parsed = parseDecisionTag(dec);
    return (
      <li
        key={`${idx}-${dec.slice(0, 20)}`}
        className={cn('req-item', parsed.badgeClass === 'badge-warn' && 'is-pending')}
      >
        <div className="req-item-meta">
          <span className={`badge ${parsed.badgeClass}`}>
            {t(parsed.tag, parsed.tagEn).replace(/^\[|\]$/g, '')}
          </span>
          <span className="req-item-kind">
            {t(parsed.categoryLabelZh, parsed.categoryLabelEn)}
          </span>
        </div>
        <p className="req-item-body">{parsed.body}</p>
      </li>
    );
  };

  const renderAggregateItem = (agg: NormalizedAggregateSignal) => (
    <li key={agg.key} className="req-item">
      <div className="req-item-meta">
        <span className="req-item-title">{agg.title}</span>
        {agg.englishCode && <code className="req-item-code">{agg.englishCode}</code>}
      </div>
      {agg.detail && <p className="req-item-body is-muted">{agg.detail}</p>}
    </li>
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
      <li key={`${idx}-${rule.slice(0, 20)}`} className="req-item is-numbered">
        <span className="req-item-index" aria-hidden="true">
          {idx + 1}
        </span>
        <p className="req-item-body">
          {hasExplicitPrefix && (
            <span className={`badge ${parsed.badgeClass} req-item-inline-badge`}>
              {t(parsed.tag, parsed.tagEn).replace(/^\[|\]$/g, '')}
            </span>
          )}
          {hasExplicitPrefix ? parsed.body : rule}
        </p>
      </li>
    );
  };

  const columns = [
    {
      id: 'DECISIONS' as const,
      icon: <CheckCircle2 size={13} aria-hidden="true" />,
      label: t('分级决策', 'Decisions'),
      hint: t('A 类自动补全 · B 类需你确认', 'Class-A auto-completed · Class-B needs you'),
      total: mergedDecisions.length,
      shown: filteredDecisions.length,
      emptyText: t(
        '对话中出现的业务边界决策会记录在这里。',
        'Business-boundary decisions from the conversation are recorded here.',
      ),
      body: filteredDecisions.map(renderDecisionItem),
    },
    {
      id: 'M1' as const,
      icon: <Boxes size={13} aria-hidden="true" />,
      label: t('领域聚合根 M1', 'Aggregates · M1'),
      hint: t('核心业务对象，已去重', 'Core business objects, deduplicated'),
      total: normalizedAggs.length,
      shown: filteredAggs.length,
      emptyText: t(
        '识别出的核心业务对象会归档在这里。',
        'Core business objects identified so far are filed here.',
      ),
      body: filteredAggs.map(renderAggregateItem),
    },
    {
      id: 'M3' as const,
      icon: <GitBranch size={13} aria-hidden="true" />,
      label: t('业务规则 M3', 'Rules · M3'),
      hint: t('阈值、准入红线与约束', 'Thresholds, gates, and constraints'),
      total: mergedRules.length,
      shown: filteredRules.length,
      emptyText: t(
        '规则阈值与准入红线会沉淀在这里。',
        'Rule thresholds and gate conditions settle here.',
      ),
      body: filteredRules.map(renderRuleItem),
    },
  ];

  return (
    <div className="req-explore">
      <section className="card req-explore-head">
        <div className="req-explore-head-main">
          <h3 className="card-title">{t('需求要素看板', 'Requirement Board')}</h3>
          <p className="req-explore-sub">
            {t(
              '与智能体对话时识别出的决策、聚合根和业务规则会自动去重归档到这里，随时可合成规格说明书。',
              'Decisions, aggregates, and rules found during the conversation are deduplicated here, ready to synthesize into an SRS.',
            )}
          </p>
        </div>
        <div className="req-explore-head-actions">
          {sessions.length > 1 && (
            <select
              className="select req-explore-source"
              aria-label={t('需求来源', 'Requirement source')}
              value={session?.id ?? ''}
              onChange={(e) => setSelectedSessionId(e.target.value)}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => onNavigate('app-req-docs')}>
            {t('需求文档', 'SRS Docs')}
            <ArrowRight size={13} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="accent"
            size="sm"
            data-testid="synthesize-srs-btn"
            disabled={!canSynthesize || synthesizingSrs}
            title={t(
              '基于需求探索对话合成 9 章节《软件需求规格说明书》',
              'Synthesize the 9-chapter SRS from the requirement conversation',
            )}
            onClick={handleSynthesizeSrs}
          >
            {synthesizingSrs ? (
              <Loader2 size={13.5} className="pipeline-spin" aria-hidden="true" />
            ) : (
              <Sparkles size={13.5} aria-hidden="true" />
            )}
            {synthesizingSrs
              ? t('正在合成规格书…', 'Synthesizing SRS…')
              : t('合成需求规格说明书', 'Synthesize SRS')}
          </Button>
        </div>
      </section>

      <section
        className="req-board"
        data-testid="requirement-board"
        data-active-tab={activeTab}
        aria-label={t('已收敛需求要素', 'Converged requirement signals')}
      >
        {totalSignalCount === 0 ? (
          <div className="req-board-empty">
            <span className="req-board-empty-mark" aria-hidden="true">
              <Sparkles size={20} />
            </span>
            <h4 className="req-board-empty-title">
              {t('还没有沉淀任何需求要素', 'No requirement signals yet')}
            </h4>
            <p className="req-board-empty-text">
              {t(
                '在右侧对话里描述业务场景、角色或规则。常规项智能体会自动补全，遇到模糊的业务边界会请你确认，结果都会归档到这块看板。',
                'Describe a scenario, role, or rule in the conversation. Routine items are auto-completed, ambiguous boundaries come back to you for confirmation, and everything is filed on this board.',
              )}
            </p>
            <Button type="button" variant="accent" size="md" onClick={openConversation}>
              <Sparkles size={14} aria-hidden="true" />
              {t('开始需求探索', 'Start Exploring')}
            </Button>
          </div>
        ) : (
          <>
            <div className="req-board-bar">
              <div
                role="tablist"
                aria-label={t('需求要素分类', 'Requirement signal categories')}
                className="req-board-tabs"
              >
                {columns.map((col, idx) => (
                  <button
                    key={col.id}
                    id={`req-signal-tab-${col.id}`}
                    type="button"
                    role="tab"
                    tabIndex={activeTab === col.id ? 0 : -1}
                    aria-selected={activeTab === col.id}
                    aria-controls={`req-signal-panel-${col.id}`}
                    className="req-tab"
                    onClick={() => setActiveTab(col.id)}
                    onKeyDown={(e) => {
                      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
                      e.preventDefault();
                      const nextIdx =
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? columns.length - 1
                            : (idx + (e.key === 'ArrowRight' ? 1 : -1) + columns.length) %
                              columns.length;
                      const nextCol = columns[nextIdx]!;
                      setActiveTab(nextCol.id);
                      document.getElementById(`req-signal-tab-${nextCol.id}`)?.focus();
                    }}
                  >
                    {col.label}
                    <span className="req-tab-count">{col.shown}</span>
                  </button>
                ))}
              </div>
              <div className="req-board-summary">
                {pendingDecisionCount > 0 ? (
                  <span className="badge badge-warn">
                    {t(`${pendingDecisionCount} 项待你确认`, `${pendingDecisionCount} awaiting you`)}
                  </span>
                ) : (
                  <span className="req-board-summary-text">
                    {t(`共 ${totalSignalCount} 项`, `${totalSignalCount} total`)}
                  </span>
                )}
              </div>
              <label className="req-board-search">
                <Search size={13} aria-hidden="true" />
                <input
                  type="search"
                  value={signalFilter}
                  onChange={(e) => setSignalFilter(e.target.value)}
                  placeholder={t('筛选要素…', 'Filter signals…')}
                  aria-label={t('筛选需求要素', 'Filter requirement signals')}
                />
              </label>
            </div>

            <div className="req-board-cols">
              {columns.map((col) => (
                <div
                  key={col.id}
                  id={`req-signal-panel-${col.id}`}
                  role="tabpanel"
                  aria-labelledby={`req-signal-tab-${col.id}`}
                  className="req-col"
                  data-col={col.id}
                >
                  <header className="req-col-head">
                    <span className="req-col-title">
                      {col.icon}
                      {col.label}
                    </span>
                    <span className="req-col-count">
                      {filterQ ? `${col.shown}/${col.total}` : col.total}
                    </span>
                    <span className="req-col-hint">{col.hint}</span>
                  </header>
                  {col.body.length === 0 ? (
                    <p className="req-col-empty">
                      {filterQ && col.total > 0
                        ? t('没有匹配的条目', 'Nothing matches the filter')
                        : col.emptyText}
                    </p>
                  ) : (
                    <ul className="req-col-list req-signal-scroller bui-scroller">{col.body}</ul>
                  )}
                </div>
              ))}
            </div>

            {!agentPanelOpen && (
              <footer className="req-board-foot">
                <span>
                  {t(
                    '想补充或修正？回到对话继续探索，看板会实时更新。',
                    'Something missing or wrong? Continue the conversation and the board updates live.',
                  )}
                </span>
                <Button type="button" variant="secondary" size="sm" onClick={openConversation}>
                  <Sparkles size={13} aria-hidden="true" />
                  {t('继续对话', 'Continue Conversation')}
                </Button>
              </footer>
            )}
          </>
        )}
      </section>
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
        workspaceLabel={t('编辑', 'Editor')}
        registryLabel={t('全部版本', 'All Versions')}
        count={docs.length}
        testIdPrefix="srs"
        centerSlot={
          pageMode === 'WORKSPACE' ? (
            <>
              {docs.length > 1 && (
                <select
                  className="select"
                  style={{ flex: '0 1 220px', width: 'auto', minWidth: 0, maxWidth: 260 }}
                  aria-label={t('切换需求规格书', 'Switch SRS document')}
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
                style={{ flex: '1 1 180px', width: 'auto', minWidth: 140 }}
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder={t('文档标题', 'Document Title')}
                aria-label={t('文档标题', 'Document Title')}
              />
              <input
                className="input"
                style={{ flex: '0 0 72px', width: 72, fontFamily: 'var(--mono)' }}
                value={docVersion}
                onChange={(e) => setDocVersion(e.target.value)}
                placeholder="v1.0"
                aria-label={t('版本号', 'Version')}
              />
              {selectedDoc && (
                <span
                  className={cn(
                    'badge shrink-0',
                    selectedDoc.status === 'DRAFT' ? 'badge-warn' : 'badge-ok',
                  )}
                >
                  {selectedDoc.status}
                </span>
              )}
            </>
          ) : undefined
        }
        rightActions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t('新建空白规格书', 'New blank SRS')}
              aria-label={t('新建空白规格书', 'New blank SRS')}
              onClick={() => void handleCreateBlankDoc()}
            >
              <Plus size={14} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t('上传本地 .md', 'Upload .md')}
              aria-label={t('上传本地 .md', 'Upload .md')}
              onClick={() => mdUploadRef.current?.click()}
            >
              <Upload size={14} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="accent" size="sm"
              data-testid="generate-prototype-btn"
              disabled={generatingProto}
              title={t(
                '基于此需求规格书生成可交互 HTML 原型',
                'Generate an interactive HTML prototype from this SRS',
              )}
              onClick={() => void handleGeneratePrototype()}
            >
              {generatingProto && <Loader2 size={13.5} className="pipeline-spin" aria-hidden="true" />}
              {generatingProto
                ? t('正在生成原型…', 'Generating…')
                : t('生成界面原型', 'Generate Prototype')}
              {!generatingProto && <ArrowRight size={13.5} aria-hidden="true" />}
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
        <TiptapMarkdownEditor
          value={content}
          onChange={setContent}
          onSave={handleSaveDoc}
          saveLabel={t('保存并确认', 'Save & Confirm')}
          downloadFilename={`${(docTitle || 'SRS').replace(/[\\/:*?"<>|]+/g, '_')}-${docVersion}.md`}
          minHeight={320}
          className="srs-editor"
        />
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
  } | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState<FourLayerAsset | null>(null);

  const [archName, setArchName] = useState('云原生 DDD 四层技术架构规范');
  const [archStackTags, setArchStackTags] = useState(
    'TypeScript, Hono, React 19, Drizzle SQLite/D1',
  );
  const [archPrompt, setArchPrompt] = useState('');
  const [startingArch, setStartingArch] = useState(false);
  const [archDialogOpen, setArchDialogOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [assetQuery, setAssetQuery] = useState('');

  useEffect(() => {
    if (!data || !activeItemId) return;
    const matched = data.fourLayerAssets.find((a) => a.id === activeItemId);
    if (matched) {
      setFilterLayer(matched.layer);
      setSelectedAssetId(matched.id);
    }
  }, [activeItemId, data?.fourLayerAssets]);

  if (!data) return null;
  const codingRunning = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === data.activeProject.id &&
      s.agentKind === 'CODING' &&
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
      setSelectedAssetId(json.asset.id);
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
    setSelectedAssetId(json.asset.id);
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
    } finally {
      setStartingArch(false);
    }
  };

  const layerMeta: Record<
    FourLayerAsset['layer'],
    { zh: string; en: string; hintZh: string; hintEn: string }
  > = {
    UI_UE: {
      zh: 'UI/UE 设计规范',
      en: 'UI/UE Guidelines',
      hintZh: '界面与交互怎么长',
      hintEn: 'How screens look and behave',
    },
    TECH_FOUNDATION: {
      zh: '技术底座',
      en: 'Tech Foundation',
      hintZh: '脚手架与基础设施',
      hintEn: 'Scaffold and infrastructure',
    },
    TECH_ARCH: {
      zh: '技术架构',
      en: 'Tech Architecture',
      hintZh: '分层与模块怎么落地',
      hintEn: 'How layers and modules land',
    },
  };
  const layerOrder: FourLayerAsset['layer'][] = ['UI_UE', 'TECH_FOUNDATION', 'TECH_ARCH'];

  const query = assetQuery.trim().toLowerCase();
  const visibleAssets = query
    ? list.filter((a) =>
        `${a.name} ${a.summary} ${a.tags.join(' ')} ${a.version}`.toLowerCase().includes(query),
      )
    : list;
  const selectedAsset =
    visibleAssets.find((a) => a.id === selectedAssetId) ?? visibleAssets[0] ?? null;
  const usedByApps = selectedAsset
    ? data.assembledApplications.filter(
        (app) =>
          app.uiUeAssetId === selectedAsset.id ||
          app.techFoundationAssetId === selectedAsset.id ||
          app.techArchAssetId === selectedAsset.id,
      )
    : [];
  const presentModelCount = data.activeProject.validation.presentModels.length;

  return (
    <div className="fla">
      {/* The four layers an application is assembled from: the project's ontology plus three reusable asset shelves */}
      <section className="fla-layers" aria-label={t('应用的四层构成', 'The four layers of an application')}>
        <div className="fla-layer is-ontology">
          <span className="fla-layer-index">1</span>
          <span className="fla-layer-text">
            <span className="fla-layer-name">{t('业务本体', 'Business Ontology')}</span>
            <span className="fla-layer-hint">
              {presentModelCount > 0
                ? t(`当前工程 · ${presentModelCount}/11 模型`, `This project · ${presentModelCount}/11 models`)
                : t('当前工程 · 尚未生成', 'This project · not synthesized yet')}
            </span>
          </span>
        </div>
        {layerOrder.map((ly, idx) => {
          const count = data.fourLayerAssets.filter((a) => a.layer === ly).length;
          const active = filterLayer === ly;
          return (
            <button
              key={ly}
              type="button"
              className="fla-layer"
              data-testid={`asset-layer-${ly}`}
              aria-pressed={active}
              onClick={() => setFilterLayer(active ? 'ALL' : ly)}
            >
              <span className="fla-layer-index">{idx + 2}</span>
              <span className="fla-layer-text">
                <span className="fla-layer-name">{t(layerMeta[ly].zh, layerMeta[ly].en)}</span>
                <span className="fla-layer-hint">{t(layerMeta[ly].hintZh, layerMeta[ly].hintEn)}</span>
              </span>
              <span className="fla-layer-count">{count}</span>
            </button>
          );
        })}
      </section>

      <section className="fla-lib" data-testid="four-layer-asset-library">
        <div className="fla-lib-grid">
        {/* Master: the shelf */}
        <div className="fla-list">
          <div className="fla-list-head">
            <label className="fla-search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                value={assetQuery}
                onChange={(e) => setAssetQuery(e.target.value)}
                placeholder={t('搜索资产…', 'Search assets…')}
                aria-label={t('搜索架构资产', 'Search architecture assets')}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              title={t('新建架构资产', 'New asset')}
              aria-label={t('新建架构资产', 'New asset')}
              onClick={openNewAssetModal}
            >
              <Plus size={14} aria-hidden="true" />
            </Button>
          </div>

          <div className="fla-list-sub">
            <span>
              {filterLayer === 'ALL'
                ? t(`全部资产 · ${visibleAssets.length}`, `All assets · ${visibleAssets.length}`)
                : `${t(layerMeta[filterLayer].zh, layerMeta[filterLayer].en)} · ${visibleAssets.length}`}
            </span>
            {filterLayer !== 'ALL' && (
              <button type="button" className="fla-clear" onClick={() => setFilterLayer('ALL')}>
                {t('查看全部', 'Show all')}
              </button>
            )}
          </div>

          {visibleAssets.length === 0 ? (
            <p className="fla-list-empty">
              {query
                ? t('没有匹配的资产', 'No assets match')
                : t('这一层还没有资产，可以新建或让 AI 生成。', 'Nothing on this shelf yet. Create one or generate with AI.')}
            </p>
          ) : (
            <ul className="fla-rows bui-scroller">
              {visibleAssets.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    className="fla-row"
                    data-testid={`asset-row-${asset.id}`}
                    aria-current={selectedAsset?.id === asset.id ? 'true' : undefined}
                    onClick={() => setSelectedAssetId(asset.id)}
                  >
                    <span className="fla-row-top">
                      <span className="fla-row-name">{asset.name}</span>
                      <span className="fla-row-version">{asset.version}</span>
                    </span>
                    <span className="fla-row-summary">{asset.summary}</span>
                    {filterLayer === 'ALL' && (
                      <span className="fla-row-layer">
                        {t(layerMeta[asset.layer].zh, layerMeta[asset.layer].en)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="fla-list-foot">
            <Button
              type="button"
              variant="accent"
              size="sm"
              className="w-full"
              data-testid="open-generate-tech-arch-btn"
              disabled={generatingArch}
              onClick={() => setArchDialogOpen(true)}
            >
              {generatingArch ? (
                <Loader2 size={13.5} className="pipeline-spin" aria-hidden="true" />
              ) : (
                <Sparkles size={13.5} aria-hidden="true" />
              )}
              {generatingArch
                ? t('正在生成架构文档…', 'Generating…')
                : t('AI 生成技术架构文档', 'Generate Tech Architecture with AI')}
            </Button>
          </div>
        </div>

        {/* Detail: the whole document, not a cropped preview */}
        <div className="fla-detail">
          {selectedAsset ? (
            <>
              <header className="fla-detail-head">
                <div className="fla-detail-title">
                  <div className="fla-detail-kicker">
                    <span className="badge badge-accent">
                      {t(layerMeta[selectedAsset.layer].zh, layerMeta[selectedAsset.layer].en)}
                    </span>
                    <span className="badge badge-ok">{selectedAsset.version}</span>
                    {usedByApps.length > 0 && (
                      <span
                        className="fla-detail-usage"
                        title={usedByApps.map((app) => app.name).join(' · ')}
                      >
                        {t(
                          `被 ${usedByApps.length} 个应用引用`,
                          `Used by ${usedByApps.length} app${usedByApps.length === 1 ? '' : 's'}`,
                        )}
                      </span>
                    )}
                  </div>
                  <h3 className="fla-detail-name">{selectedAsset.name}</h3>
                  {selectedAsset.summary && selectedAsset.summary !== selectedAsset.name && (
                    <p className="fla-detail-summary">{selectedAsset.summary}</p>
                  )}
                  {selectedAsset.tags.length > 0 && (
                    <div className="fla-detail-tags">
                      {selectedAsset.tags.map((tg) => (
                        <span key={tg} className="badge">
                          {tg}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="fla-detail-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => openEditAssetModal(selectedAsset)}
                  >
                    <Edit3 size={13} aria-hidden="true" />
                    {t('编辑', 'Edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleCloneAsset(selectedAsset)}
                    title={t('克隆副本', 'Clone')}
                    aria-label={t('克隆副本', 'Clone')}
                  >
                    <Copy size={13} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red"
                    onClick={() => setDeletingAsset(selectedAsset)}
                    title={
                      usedByApps.length > 0
                        ? t('已被应用引用，删除会被拦截', 'Referenced by an app; deletion is blocked')
                        : t('删除资产', 'Delete')
                    }
                    aria-label={t('删除资产', 'Delete')}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </Button>
                </div>
              </header>
              <div className="fla-detail-body bui-scroller">
                <MarkdownRenderer content={selectedAsset.specMarkdown} />
              </div>
            </>
          ) : (
            <div className="fla-detail-empty">
              <Layers size={22} aria-hidden="true" />
              <p>
                {t(
                  '从左侧选择一份资产查看完整规范，或新建一份。',
                  'Pick an asset on the left to read its full spec, or create a new one.',
                )}
              </p>
            </div>
          )}
        </div>
        </div>
      </section>

      {/* AI Tech-Stack-to-Architecture Generator: asked for only when wanted */}
      {archDialogOpen && (
        <div className="modal-backdrop" onClick={() => setArchDialogOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t('AI 生成技术架构文档', 'Generate Tech Architecture with AI')}
            style={{ maxWidth: 520 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <div>
                <h3 className="card-title">{t('AI 生成技术架构文档', 'Generate Tech Architecture with AI')}</h3>
                <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-ink-3">
                  {t(
                    '给出技术栈，智能体会结合当前工程的业务本体写出四层技术架构规范，并存入「技术架构」。',
                    'Name the stack; the agent combines it with this project\'s ontology and files the spec under Tech Architecture.',
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('关闭', 'Close')}
                onClick={() => setArchDialogOpen(false)}
              >
                ✕
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              <div className="form-field">
                <label className="form-label" htmlFor="arch-gen-name">
                  {t('文档名称', 'Document name')}
                </label>
                <input
                  id="arch-gen-name"
                  className="input"
                  value={archName}
                  onChange={(e) => setArchName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="arch-gen-stack">
                  {t('技术栈（逗号分隔）', 'Tech stack (comma separated)')}
                </label>
                <input
                  id="arch-gen-stack"
                  className="input"
                  value={archStackTags}
                  onChange={(e) => setArchStackTags(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="arch-gen-prompt">
                  {t('补充约束（选填）', 'Extra constraints (optional)')}
                </label>
                <textarea
                  id="arch-gen-prompt"
                  className="input"
                  rows={3}
                  value={archPrompt}
                  onChange={(e) => setArchPrompt(e.target.value)}
                  placeholder={t('例如：要求严格的 Deep Modules 边界', 'e.g. Strict module boundaries')}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" size="md" onClick={() => setArchDialogOpen(false)}>
                  {t('取消', 'Cancel')}
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  size="md"
                  data-testid="generate-tech-arch-btn"
                  disabled={generatingArch}
                  onClick={() => {
                    setArchDialogOpen(false);
                    void handleGenerateTechArch();
                  }}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {t('开始生成', 'Generate')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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

            <div className="flex flex-col gap-2.5">
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
export function ApplicationAssemblyDevView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
} = {}) {
  const { t } = usePreferences();
  const {
    data,
    liveSessionDrafts,
    ensureProjectAgentSession,
    patchData,
    setActiveItemId,
    setActiveSessionId,
    showToast,
    startSessionAgentRun,
    switchProject,
  } = useWorkbenchStore();
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

  const allApps = data?.assembledApplications ?? [];
  const projectApps = allApps.filter((a) => a.projectId === data?.activeProject.id);
  const app = projectApps.find((a) => a.id === selectedAppId) ?? projectApps[0];

  useEffect(() => {
    if (!data) return;
    const scoped = data.assembledApplications.filter((a) => a.projectId === data.activeProject.id);
    if (scoped.length === 0) {
      setSelectedAppId('');
      setCompiledPkg(null);
    } else if (!scoped.some((a) => a.id === selectedAppId)) {
      setSelectedAppId(scoped[0]!.id);
      setCompiledPkg(null);
    }
    const uiAssets = data.fourLayerAssets.filter((a) => a.layer === 'UI_UE');
    const fnAssets = data.fourLayerAssets.filter((a) => a.layer === 'TECH_FOUNDATION');
    const arAssets = data.fourLayerAssets.filter((a) => a.layer === 'TECH_ARCH');
    setSelProjectId(data.activeProject.id);
    if (!selUiAssetId && uiAssets[0]) setSelUiAssetId(uiAssets[0].id);
    if (!selFoundationId && fnAssets[0]) setSelFoundationId(fnAssets[0].id);
    if (!selArchId && arAssets[0]) setSelArchId(arAssets[0].id);
  }, [data?.activeProject.id, data?.assembledApplications.length, data?.fourLayerAssets.length]);

  useEffect(() => {
    if (app?.id) {
      setActiveItemId(app.id);
    }
  }, [app?.id, setActiveItemId]);

  if (!data) return null;
  const lifecycle = getProjectLifecycleState(data);

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
    <div className="flex flex-col gap-3.5">
      <ViewModeHeader
        mode={pageMode}
        onChange={setPageMode}
        workspaceLabel={t('当前工程四层装配台', 'Project Assembly Workspace')}
        registryLabel={t('全部装配应用注册表', 'All Assembled Apps')}
        count={allApps.length}
        testIdPrefix="app-assembly"
        rightActions={
          <>
            <Button
              type="button"
              variant="secondary" size="sm"
              disabled={!lifecycle.hasOntology}
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
          rows={allApps}
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
          onRowClick={async (a) => {
            if (a.projectId !== data.activeProject.id) {
              await switchProject(a.projectId);
            }
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
                  <div className="font-mono text-[11.5px] text-ink-3">
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
                    onClick={async () => {
                      if (a.projectId !== data.activeProject.id) {
                        await switchProject(a.projectId);
                      }
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
      ) : !app ? (
        <div
          className="card py-12 px-6 flex flex-col items-center text-center gap-3 max-w-[680px] mx-auto my-4"
          data-testid="assembly-stage-pending"
        >
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-inset text-accent">
            <Layers size={20} />
          </div>
          <span className={`badge ${lifecycle.hasOntology ? 'badge-ok' : 'badge-warn'}`}>
            {lifecycle.hasOntology
              ? t('第 5 步 · 本体已就绪，可组装应用', 'Step 5 · Ready to Assemble')
              : t('第 5 步 · 尚未到达此阶段', 'Step 5 · Stage Not Reached Yet')}
          </span>
          <h3 className="font-serif text-[18px] font-semibold text-ink m-0">
            {t(
              `「${data.activeProject.name}」尚未创建四层装配应用`,
              `"${data.activeProject.name}" has no assembled application yet`,
            )}
          </h3>
          <p className="text-[13px] text-ink-3 max-w-[540px] leading-relaxed m-0">
            {lifecycle.hasOntology
              ? t(
                  '当前工程的业务本体已准备就绪。点击下方按钮将「业务本体 + UI/UE 规范 + 技术底座 + 技术架构」四层资产组装为一个应用，即可一键编译导出《开发指导书.md》与代码开发包。',
                  'Your ontology is ready. Assemble the 4 architectural layers into an application to compile development guides and ZIP packages.',
                )
              : t(
                  '四层应用开发需要将第 4 步生成的「业务本体」与架构资产绑定编译。由于当前工程仍在推进前置阶段，此处不展示其他示例工程的应用以免混淆。',
                  'Application assembly binds your Step 4 Business Ontology with architectural assets. Complete upstream stages first.',
                )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
            {lifecycle.hasOntology ? (
              <Button
                type="button"
                variant="accent"
                size="md"
                onClick={() => setNewAppOpen(true)}
              >
                <Plus size={14} />
                {t('为当前工程创建四层装配应用', 'Create 4-Layer App for Project')}
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
      ) : (
        <>
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <strong className="text-[13px]">
                  {t('当前装配应用：', 'Active Application: ')}
                </strong>
                {projectApps.length > 0 && (
                  <select
                    className="select"
                    style={{ width: 260 }}
                    value={app?.id ?? ''}
                    onChange={(e) => {
                      setSelectedAppId(e.target.value);
                      setCompiledPkg(null);
                    }}
                  >
                    {projectApps.map((item) => (
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
              <div className="grid grid-cols-4 gap-2.5"
              >
                <div className="p-2.5 bg-inset rounded-[5px] flex flex-col gap-1.5">
                  <div className="text-[11.5px] text-muted-foreground">
                    1. {t('业务本体层', 'Ontology Layer')}
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

                <div className="p-2.5 bg-inset rounded-[5px] flex flex-col gap-1.5">
                  <div className="text-[11.5px] text-muted-foreground">
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

                <div className="p-2.5 bg-inset rounded-[5px] flex flex-col gap-1.5">
                  <div className="text-[11.5px] text-muted-foreground">
                    3. {t('技术底座层', 'Tech Foundation Layer')}
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

                <div className="p-2.5 bg-inset rounded-[5px] flex flex-col gap-1.5">
                  <div className="text-[11.5px] text-muted-foreground">
                    4. {t('技术架构层', 'Tech Architecture Layer')}
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
            <div className="grid grid-cols-[330px_minmax(0,1fr)] gap-3"
              data-testid="compiled-package-inspector"
            >
              <div className="card" style={{ maxHeight: 540, overflowY: 'auto' }}>
                <div className="card-header">
                  <h4 className="card-title">
                    {t('开发资料包目录树', 'Package File Tree')} ({compiledPkg.files.length})
                  </h4>
                </div>
                <div className="flex flex-col gap-0.75">
                  {compiledPkg.files.map((file) => (
                    <button
                      key={file.relativePath}
                      type="button"
                      className={`nav-item ${selectedFilePath === file.relativePath ? 'active' : ''}`}
                      onClick={() => setSelectedFilePath(file.relativePath)}
                    >
                      <span
                        className="nav-item-left font-mono text-[11.5px]"
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
                  <strong className="font-mono">
                    {activeFile?.relativePath}
                  </strong>
                  <div className="flex gap-2 items-center">
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

          {/* Unified AI Coding Agent Quick Actions (Runs in Right Agent Panel) + Real-Time Logs */}
          {app && (
            <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-3">
              <div className="card flex flex-col justify-between gap-3" data-testid="coding-agent-context-card">
                <div className="space-y-2.5">
                  <div className="card-header" style={{ marginBottom: 0 }}>
                    <div>
                      <h4 className="card-title inline-flex items-center gap-1.5">
                        <Code2 size={15} className="text-accent" />
                        {t('四层架构 AI 研发智能体', '4-Layer AI Coding Agent')}
                      </h4>
                      <div className="text-[12px] text-muted-foreground mt-0.5">
                        {t(
                          '基于渐进式《开发资料包》执行代码骨架生成、包编译与门禁校验（已在右侧 Agent 面板就绪）',
                          'Generates domain repositories, routes, UI components & compiles dev packages in the unified Agent Panel',
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="accent"
                      size="sm"
                      onClick={() => {
                        setActiveItemId(app.id);
                        useAgentPanelStore.getState().revealPanel();
                      }}
                    >
                      {t('打开右侧研发 Agent →', 'Open Coding Agent →')}
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 pt-1">
                    {[
                      t(
                        '基于当前四层装配生成 M1/M3 领域聚合仓储与门禁校验代码骨架',
                        'Generate M1/M3 domain repository and rule guard code scaffolding',
                      ),
                      t(
                        '编译渐进式《开发资料包》并核验完成度门禁清单',
                        'Compile progressive Development Package and verify completion gates',
                      ),
                    ].map((starter, idx) => {
                      const codingRunning = (data.agentSessions ?? []).some(
                        (s) =>
                          s.projectId === data.activeProject.id &&
                          s.agentKind === 'CODING' &&
                          s.targetId === app.id &&
                          (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
                      );
                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={codingRunning}
                          onClick={() => {
                            setActiveItemId(app.id);
                            useAgentPanelStore.getState().revealPanel();
                            void (async () => {
                              const codingSess = await ensureProjectAgentSession(
                                data.activeProject.id,
                                'CODING',
                                {
                                  targetId: app.id,
                                  title: `${app.name} · ${t('四层架构 AI 研发智能体', '4-Layer AI Coding Agent')}`,
                                },
                              );
                              setActiveSessionId(codingSess.id);
                              await startSessionAgentRun({
                                sessionId: codingSess.id,
                                prompt: starter,
                              });
                            })();
                          }}
                          className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface-2 px-3 py-2 text-left text-[12.5px] text-ink transition-colors hover:border-accent hover:bg-accent-soft cursor-pointer disabled:opacity-50"
                        >
                          <span>{starter}</span>
                          <ArrowRight size={13} className="shrink-0 text-accent" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-control border border-line bg-inset/45 p-2.5 text-[11.5px] text-ink-3">
                  {t(
                    `装配应用：${app.name} (${app.status} · ${app.publishedVersion || 'v1.0.0'})`,
                    `Application: ${app.name} (${app.status} · ${app.publishedVersion || 'v1.0.0'})`,
                  )}
                </div>
              </div>

              <div className="card" style={{ maxHeight: 480, overflowY: 'auto' }}>
                <div className="card-header">
                  <h4 className="card-title">
                    {t('构建与发布流水日志', 'Build & Release Logs')} ({app.agentDevLogs.length})
                  </h4>
                </div>
                <div className="flex flex-col gap-1.5">
                  {[...app.agentDevLogs].reverse().map((log, i) => (
                    <div
                      key={i} className="p-[6px_10px] bg-inset rounded-[4px] font-mono text-[11.5px]"
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

export function AppPublishView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
} = {}) {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [versionInputs, setVersionInputs] = useState<Record<string, string>>({});
  const [endpointInputs, setEndpointInputs] = useState<Record<string, string>>({});

  if (!data) return null;
  const lifecycle = getProjectLifecycleState(data);
  const projectApps = lifecycle.projectApps;

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

  if (projectApps.length === 0) {
    return (
      <div className="card py-12 px-6 flex flex-col items-center text-center gap-3 max-w-[680px] mx-auto my-4">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-inset text-accent">
          <Boxes size={20} />
        </div>
        <span className="badge badge-warn">
          {t('尚未到达此阶段 · 暂无待发布应用', 'Stage Not Reached · No App to Release')}
        </span>
        <h3 className="font-serif text-[18px] font-semibold text-ink m-0">
          {t(
            `「${data.activeProject.name}」暂无可发布的装配应用`,
            `"${data.activeProject.name}" has no assembled application to release yet`,
          )}
        </h3>
        <p className="text-[13px] text-ink-3 max-w-[540px] leading-relaxed m-0">
          {t(
            '应用发布处于研发流水线末端，需要对当前工程在「应用开发」阶段组装的应用执行 4A 门禁核验与版本发布。请先按顺序推进前置阶段。',
            'App Release runs 4A gate verification on assembled applications of this project. Complete upstream stages first.',
          )}
        </p>
        {onNavigate && (
          <Button
            type="button"
            variant="accent"
            size="md"
            onClick={() =>
              onNavigate(lifecycle.hasOntology ? 'app-assembly-dev' : lifecycle.nextStep.targetView)
            }
          >
            {lifecycle.hasOntology
              ? t('前往应用开发组装当前工程应用', 'Go to App Assembly')
              : t(lifecycle.nextStep.labelZh, lifecycle.nextStep.labelEn)}
            <ArrowRight size={14} />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {projectApps.map((app) => (
        <div key={app.id} className="card flex flex-col gap-2.5">
          <div className="card-header" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
            <div>
              <h3 className="card-title">{app.name}</h3>
              <div className="font-mono text-[12.5px] text-muted-foreground">
                {app.publishedEndpoint || `/apps/${app.id}`} ·{' '}
                {app.packageOutputDir || `.onto-cs/packages/${app.id}`}
              </div>
            </div>
            <div className="flex gap-1.5 items-center flex-wrap">
              <span className="badge badge-accent">4A Gate: BA · DA · AA · TA</span>
              <span className="badge badge-ok">
                {app.status} · {app.publishedVersion || 'v1.0.0'}
              </span>
            </div>
          </div>

          <div className="p-[10px_12px] rounded-[6px] bg-inset border border-line flex items-center gap-2 flex-wrap"
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
            <div className="text-[12.5px] font-semibold mb-1.5">
              {t('Agent 研发与发布流水日志', 'Agent Build & Release Logs')}
            </div>
            <div className="flex flex-col gap-1.5">
              {app.agentDevLogs.map((log, i) => (
                <div
                  key={i} className="p-[6px_10px] bg-inset rounded-[4px] font-mono text-[11.5px]"
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
