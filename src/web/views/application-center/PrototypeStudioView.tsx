import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Info,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';
import { BUSINESS_VOCABULARY } from '../../../packages/business-vocabulary/index.js';
import { extractMuFromPrototypeHtml, latestPrototypeBuild } from '../../../packages/ontology-core/index.js';
import type { InteractivePrototype } from '../../../packages/workspace-store/index.js';
import {
  apiConfirmPrototypeRevision,
  apiListPrototypes,
  useWorkbenchStore,
} from '../../api.js';
import { useAgentPanelStore } from '../../components/agent/agentPanelStore.js';
import { resolveActiveVisionCapability } from '../../components/agent/VisionAttachmentControls.js';
import { Button } from '../../components/beautifui/index.js';
import { ArtifactHistoryDrawer } from '../../components/history/index.js';
import {
  PrototypeCanvasStage,
  runImportPrototypeHtml,
  type PrototypeCanvasStageProps,
} from '../../components/prototype/PrototypeCanvasStage.js';
import { decideDesignBriefForMe } from '../../components/prototype/DesignBriefAndStyleTile.js';
import { PrototypeCoDesignStudio } from '../../components/prototype/PrototypeCoDesignStudio.js';
import { formatPrototypeLabelForBusinessView } from '../../components/prototype/PrototypeRevisionHistory.js';
import {
  toRefinementSelections,
  type PrototypeSelectionTarget,
  type PrototypeVisualAnnotation,
} from '../../components/prototype/PrototypeVisualInspector.js';
import { PrototypePostRunBanner } from '../../components/prototype/SelectionAttachmentStrip.js';
import {
  ingestSelectionTargetAsAttachment,
  resolveLiveRunningPrototypeAnchor,
  resolvePostRunPrototypeReview,
  revertPostRunToPreviousRevision,
  submitPrototypeComposerTurnWithSelections,
  upgradeSelectionAttachmentCrop,
  usePrototypeSelectionStore,
} from '../../components/prototype/prototypeSelectionStore.js';
import { usePreferences, type NavViewId } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  getProjectStepsFromBootstrap,
  useStepViewMode,
} from '../../navigation/index.js';

// ─── Prototype Step (原型步骤: Briefing Stage <-> Canvas Stage) ──────────────
export type PrototypeStudioStage = 'BRIEFING' | 'CANVAS';

/** Placeholder id of the prototype a first build is creating, before its revision is saved. */
export const PENDING_LIVE_PROTOTYPE_ID = 'pending-live-prototype';

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
  defaultBriefStep?: 'REFERENCES' | 'FEEL' | 'MOTION';
  defaultHistoryOpen?: boolean;
  renderRevisionHistory?: PrototypeCanvasStageProps['renderRevisionHistory'];
  renderConfirmModal?: PrototypeCanvasStageProps['renderConfirmModal'];
}

export function PrototypeStudioView({
  onNavigate,
  defaultStageOverride = null,
  defaultBriefStep,
  defaultHistoryOpen,
  renderRevisionHistory,
  renderConfirmModal,
}: PrototypeStudioViewProps = {}) {
  const { locale, t } = usePreferences();
  const [viewMode, setViewMode] = useStepViewMode('PROTOTYPE');
  const {
    data,
    activeItemId,
    activePrototypeIdByProject,
    liveSessionDrafts,
    historyDrawerArtifactKind,
    highlightedPrototypeTarget,
    highlightedPrototypeComparePair,
    patchData,
    showToast,
    setActivePrototypeId,
    setActiveSessionId,
    closeArtifactHistoryDrawer,
    undoArtifactChange,
    restoreArtifactBeforeChange,
    focusPrototypeTarget,
    ensurePrototypeCoDesignSession,
    startSessionAgentRun,
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
  const [confirmingAsIs, setConfirmingAsIs] = useState(false);
  const [updatingWithAssistant, setUpdatingWithAssistant] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [visualAnnotations, setVisualAnnotations] = useState<PrototypeVisualAnnotation[]>([]);
  const [canvasFocusMode, setCanvasFocusMode] = useState(false);
  const [historyBusyEntryId, setHistoryBusyEntryId] = useState<string | null>(null);
  const [synthesisSummary, setSynthesisSummary] = useState<{
    modelCount: number;
    errorCount: number;
  } | null>(null);

  const htmlUploadRef = useRef<HTMLInputElement | null>(null);

  const prototypes = data?.prototypes ?? [];
  const confirmedRevision = data?.confirmedPrototypeRevision ?? null;
  const proto = prototypes.find((p) => p.id === selectedProtoId) ?? prototypes[0];
  const confirmedRequirementsDoc = useMemo(() => {
    const reqConf = data?.stepConfirmations?.requirements;
    if (!reqConf) return undefined;
    return {
      id: reqConf.docId,
      projectId: reqConf.projectId,
      title: reqConf.title,
      version: reqConf.version,
      status: 'CONFIRMED' as const,
      content: reqConf.content,
      updatedAt: reqConf.confirmedAt,
    };
  }, [data?.stepConfirmations?.requirements]);
  const docs = useMemo(
    () => (confirmedRequirementsDoc ? [confirmedRequirementsDoc] : []),
    [confirmedRequirementsDoc],
  );
  const projectSteps = useMemo(
    () => (data ? getProjectStepsFromBootstrap(data) : []),
    [data],
  );
  const protoStep = useMemo(
    () => projectSteps.find((s) => s.id === 'PROTOTYPE') ?? null,
    [projectSteps],
  );

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

  const unboundLiveSession = useMemo(() => {
    if (!data || prototypes.length > 0) return undefined;
    return (data.agentSessions ?? []).find(
      (s) =>
        s.projectId === data.activeProject.id &&
        s.agentKind === 'PROTOTYPE_CO_DESIGN' &&
        Boolean(liveSessionDrafts[s.id]),
    );
  }, [data, liveSessionDrafts, prototypes.length]);

  const liveDraft = coDesignSession
    ? liveSessionDrafts[coDesignSession.id]
    : unboundLiveSession
      ? liveSessionDrafts[unboundLiveSession.id]
      : undefined;
  const activeRunningAnchor = resolveLiveRunningPrototypeAnchor(coDesignSession, liveDraft);
  // The Build Plan as the latest build left it (#90): failed screens keep 「继续这一屏」 after the run.
  const persistedBuild = latestPrototypeBuild(coDesignSession?.messages);
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
    const targetDoc = docs.find((d) => d.id === activeItemId);
    if (targetDoc) {
      setSelectedDocId(targetDoc.id);
      setStageOverride('BRIEFING');
    }
  }, [activeItemId, data?.prototypes, docs]);

  useEffect(() => {
    if (!data || !highlightedPrototypeTarget) return;
    if (data.prototypes.some((p) => p.id === highlightedPrototypeTarget.prototypeId)) {
      setSelectedProtoId(highlightedPrototypeTarget.prototypeId);
      setStageOverride('CANVAS');
    }
  }, [highlightedPrototypeTarget?.seq, data?.prototypes]);

  useEffect(() => {
    if (!data || !highlightedPrototypeComparePair) return;
    if (data.prototypes.some((p) => p.id === highlightedPrototypeComparePair.prototypeId)) {
      setSelectedProtoId(highlightedPrototypeComparePair.prototypeId);
      setStageOverride('CANVAS');
    }
  }, [highlightedPrototypeComparePair?.seq, data?.prototypes]);

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
  const isBusyProto = refining || updatingWithAssistant || isRunningCoDesignSession;
  const visionCapability = resolveActiveVisionCapability(data);

  const currentStage = resolvePrototypeStudioStage(prototypes.length, stageOverride);
  const stepState = protoStep?.state ?? 'NOT_STARTED';
  const isOutdated = stepState === 'OUTDATED' && prototypes.length > 0;
  const isBlockedByUnconfirmedRequirements =
    viewMode === 'business' &&
    data.stepConfirmations !== undefined &&
    !data.stepConfirmations.requirements &&
    prototypes.length === 0 &&
    defaultStageOverride === null;

  const importHtmlFile = async (file: File) => {
    if (!/\.(html?|xhtml)$/i.test(file.name) && file.type && !file.type.includes('html')) {
      showToast(
        t('请选择网页格式的原型文件', 'Please select a web prototype file'),
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
      ...(res.artifactHistory ? { artifactHistory: res.artifactHistory } : {}),
    });
    setSelectedProtoId(res.prototype.id);
    setStageOverride('CANVAS');
    const cleanName = formatPrototypeLabelForBusinessView(
      res.prototype.name,
      t('界面原型', 'Prototype'),
    );
    showToast(
      viewMode === 'business'
        ? t(`已导入原型「${cleanName}」`, `Imported prototype "${cleanName}"`)
        : t(
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
    if (isBusyProto) return;
    if (!confirmedRequirementsDoc) {
      showToast(
        t(
          '需要先在「需求」步骤确认需求文档，才能生成界面原型',
          'Confirm your requirements document in the Requirements step first before generating a prototype',
        ),
      );
      return;
    }
    const promptNote = options?.prompt?.trim() || `${project.name} 交互界面原型`;
    const decided = await decideDesignBriefForMe({
      project,
      doc: confirmedRequirementsDoc,
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

  const handleAskAssistantToUpdate = async () => {
    if (!proto || !confirmedRequirementsDoc || isBusyProto) return;
    setUpdatingWithAssistant(true);
    try {
      setActivePrototypeId(project.id, proto.id);
      const session = await ensurePrototypeCoDesignSession(project.id, proto.id);
      setActiveSessionId(session.id);
      useAgentPanelStore.getState().revealPanel();
      setStageOverride('CANVAS');

      const prompt =
        locale === 'en-US'
          ? [
              `Requirements have been re-confirmed (${confirmedRequirementsDoc.title} ${confirmedRequirementsDoc.version}).`,
              'Please review the updated confirmed Requirements below, update the existing prototype screens, fields, and interactive actions to align with the changes while preserving the established visual style, and save a new prototype revision:',
              '',
              confirmedRequirementsDoc.content,
            ].join('\n')
          : [
              `「需求」步骤有了新的确认（《${confirmedRequirementsDoc.title}》${confirmedRequirementsDoc.version}）。`,
              '请对照下方最新已确认的需求内容，在保持现有视觉风格与布局体系的前提下，更新当前原型的相关界面、字段与交互操作，并保存为新修订版本：',
              '',
              confirmedRequirementsDoc.content,
            ].join('\n');

      await startSessionAgentRun({
        sessionId: session.id,
        prompt,
        displayTitle: t(
          '根据最新确认的需求更新原型',
          'Update prototype from re-confirmed requirements',
        ),
      });
    } finally {
      setUpdatingWithAssistant(false);
    }
  };

  const handleConfirmPrototypeAsIs = async () => {
    if (!proto || confirmingAsIs || isBusyProto) return;
    const targetRevId =
      confirmedRevision?.revisionId ?? proto.confirmedRevisionId ?? proto.currentRevisionId;
    if (!targetRevId) return;
    setConfirmingAsIs(true);
    try {
      const res = await apiConfirmPrototypeRevision(project.id, targetRevId);
      patchData({
        prototypes: res.prototypes,
        confirmedPrototypeRevision: res.confirmedRevision,
        activeProject: res.project,
        ...(res.stepConfirmations ? { stepConfirmations: res.stepConfirmations } : {}),
      });
      showToast(
        t(
          '已按现状确认当前原型，无需改动',
          'Confirmed current prototype as is without changes',
        ),
      );
    } finally {
      setConfirmingAsIs(false);
    }
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
          '请先在原型画布确认原型版本，再整理业务模型',
          'Confirm a prototype revision first before generating the Business Model',
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

  const statusBanners =
    synthesisSummary && viewMode === 'technical' ? (
      <div className="flex items-center justify-between gap-2.5 rounded-sm border border-border bg-success-soft p-[8px_12px]">
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

  const renderStageBody = (stageViewMode: 'business' | 'technical') => {
    const primaryHandledAbove =
      stageViewMode === 'business' &&
      (isOutdated || (currentStage === 'CANVAS' && stepState === 'CONFIRMED' && Boolean(onNavigate)));

    // The first build runs before anything is saved: the canvas stage shows it with a
    // placeholder prototype, so the same canvas instance carries on once the revision lands.
    const pendingLivePrototype: InteractivePrototype | null =
      prototypes.length === 0 && unboundLiveSession && liveDraft && stageOverride !== 'BRIEFING'
        ? {
            id: PENDING_LIVE_PROTOTYPE_ID,
            projectId: project.id,
            name: t(`${project.name}交互原型`, `${project.name} Prototype`),
            revisions: [],
            currentRevisionId: '',
            createdAt: new Date(liveDraft.startedAt).toISOString(),
            updatedAt: new Date(liveDraft.startedAt).toISOString(),
            version: 'v0',
            htmlContent: '',
            extractedScreenCount: 0,
            isConfirmed: false,
            aheadOfConfirmedCount: 0,
          }
        : null;
    const canvasProto = currentStage === 'CANVAS' && proto ? proto : pendingLivePrototype;
    // Nothing that reaches the server may carry the placeholder: those actions wait for the save.
    const savedProtoId = canvasProto && canvasProto !== pendingLivePrototype ? canvasProto.id : null;

    if (canvasProto) {
      return (
        <PrototypeCanvasStage
          project={project}
          prototypes={canvasProto === pendingLivePrototype ? [canvasProto] : prototypes}
          selectedPrototypeId={canvasProto.id}
          pendingLive={canvasProto === pendingLivePrototype}
          liveState={liveDraft?.prototypeLive ?? null}
          persistedBuild={persistedBuild ?? null}
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
              ...(payload.artifactHistory ? { artifactHistory: payload.artifactHistory } : {}),
            });
            if (payload.selectedPrototypeId !== undefined) {
              setSelectedProtoId(payload.selectedPrototypeId);
              setActivePrototypeId(project.id, payload.selectedPrototypeId);
              const nextProto = payload.prototypes.find(
                (p) => p.id === payload.selectedPrototypeId,
              );
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
            if (!savedProtoId) return;
            void ingestSelectionTargetAsAttachment(savedProtoId, target, { crop: crop ?? null });
          }}
          onSelectionCropUpgrade={(cssSelector, crop) => {
            if (!savedProtoId) return;
            void upgradeSelectionAttachmentCrop(savedProtoId, cssSelector, crop);
          }}
          annotations={combinedCanvasAnnotations}
          onAddAnnotation={handleAddVisualAnnotation}
          onApplyImmediate={(target, note) => void handleImmediateSelectionRefine(target, note)}
          activeRunningAnchor={activeRunningAnchor}
          flashedAnchors={
            highlightedPrototypeTarget &&
            highlightedPrototypeTarget.prototypeId === canvasProto.id &&
            (highlightedPrototypeTarget.screenId || highlightedPrototypeTarget.elementId)
              ? [
                  {
                    ...(highlightedPrototypeTarget.screenId
                      ? { screenId: highlightedPrototypeTarget.screenId }
                      : {}),
                    ...(highlightedPrototypeTarget.elementId
                      ? { elementId: highlightedPrototypeTarget.elementId }
                      : {}),
                  },
                ]
              : shouldFlashModifiedAnchors && postRunReview
                ? postRunReview.modifiedAnchors
                : []
          }
          flashKey={
            highlightedPrototypeTarget && highlightedPrototypeTarget.prototypeId === canvasProto.id
              ? `jump-${highlightedPrototypeTarget.seq}`
              : (postRunReview?.revision.id ?? null)
          }
          htmlOverride={
            postRunReview && beforeAfterMode === 'BEFORE'
              ? postRunReview.previousRevision.htmlContent
              : null
          }
          busy={isBusyProto || Boolean(activeRunningAnchor)}
          {...(liveDraft?.subagentLanes ? { subagentLanes: liveDraft.subagentLanes } : {})}
          {...(liveDraft?.liveStreamedChars !== undefined
            ? { liveStreamedChars: liveDraft.liveStreamedChars }
            : {})}
          {...(liveDraft?.reconnecting !== undefined ? { reconnecting: liveDraft.reconnecting } : {})}
          onRetryScreen={(screenId, screenName) => {
            if (!savedProtoId) return;
            void (async () => {
              const targetSession = await ensurePrototypeCoDesignSession(project.id, savedProtoId);
              setActiveSessionId(targetSession.id);
              useAgentPanelStore.getState().revealPanel();
              // 「继续这一屏」 redoes exactly this planned screen with one helper (#90).
              const said = locale === 'en-US' ? `Continue screen "${screenName}"` : `继续画「${screenName}」`;
              await startSessionAgentRun({
                sessionId: targetSession.id,
                prompt: `[ACTION:RESUME_PROTOTYPE_SCREEN ${JSON.stringify({ screenId })}] ${said}`,
                displayTitle: said,
              });
            })();
          }}
          focusMode={canvasFocusMode}
          onFocusModeChange={setCanvasFocusMode}
          canvasBannerSlot={canvasBannerContent}
          viewMode={stageViewMode}
          primaryActionHandledAbove={primaryHandledAbove}
          {...(defaultHistoryOpen !== undefined ? { defaultHistoryOpen } : {})}
          {...(renderRevisionHistory ? { renderRevisionHistory } : {})}
          {...(renderConfirmModal ? { renderConfirmModal } : {})}
        />
      );
    }

    const unboundBrief =
      prototypes.length === 0
        ? (data.agentSessions ?? [])
            .filter((s) => s.projectId === project.id && s.agentKind === 'PROTOTYPE_CO_DESIGN')
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .find((s) => s.designBrief)?.designBrief
        : undefined;

    return (
      <PrototypeCoDesignStudio
        project={project}
        docs={docs}
        selectedDocId={selectedDocId}
        onSelectDocId={setSelectedDocId}
        prototypes={prototypes}
        {...(prototypes.length > 0 && proto ? { activePrototype: proto } : {})}
        {...(unboundBrief ? { initialDesignBrief: unboundBrief } : {})}
        visionSupported={visionCapability.visionSupported}
        {...(visionCapability.providerLabel
          ? { visionProviderLabel: visionCapability.providerLabel }
          : {})}
        {...(onNavigate ? { onOpenLlmCenter: () => onNavigate('llm-center') } : {})}
        onConfirmGenerateBrief={async ({ brief, compiledPrompt, prototypeName, images }) => {
          if (!confirmedRequirementsDoc) {
            showToast(
              t(
                '需要先在「需求」步骤确认需求文档，才能生成界面原型',
                'Confirm your requirements document in the Requirements step first before generating a prototype',
              ),
            );
            return;
          }
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
        viewMode={stageViewMode}
        {...(defaultBriefStep ? { defaultBriefStep } : {})}
      />
    );
  };

  // ─── Technical Details Mode ────────────────────────────────────────────────
  if (viewMode === 'technical') {
    const extractedMu = proto
      ? extractMuFromPrototypeHtml(proto.htmlContent, project.domain)
      : null;
    const protoConfirmation = data.stepConfirmations?.prototype ?? null;

    return (
      <div
        className="flex flex-col gap-3"
        data-testid="prototype-technical-details"
        style={canvasFocusMode ? { animation: 'none', transform: 'none' } : undefined}
      >
        <input
          ref={htmlUploadRef}
          type="file"
          accept=".html,.htm"
          className="hidden"
          onChange={handleUploadHtml}
        />

        <div className="card flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 font-title text-[16px] font-semibold text-foreground">
              {t('界面原型 · 技术细节', 'Prototype · Technical Details')}
            </h2>
            {protoConfirmation && (
              <span className="badge font-mono text-[12px]">
                {protoConfirmation.revisionId} · basedOn:{' '}
                {protoConfirmation.basedOnConfirmationId ?? 'none'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="technical-import-html-btn"
              onClick={() => htmlUploadRef.current?.click()}
            >
              <Upload size={13.5} aria-hidden="true" />
              {t('导入 HTML', 'Import HTML')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="prototype-view-mode-toggle"
              onClick={() => setViewMode('business')}
            >
              <ArrowLeft size={13.5} aria-hidden="true" />
              {t(
                `返回${BUSINESS_VOCABULARY.BUSINESS_VIEW.zh}`,
                `Back to ${BUSINESS_VOCABULARY.BUSINESS_VIEW.en}`,
              )}
            </Button>
          </div>
        </div>

        {currentStage === 'BRIEFING' && statusBanners}

        {renderStageBody('technical')}

        <section
          data-testid="prototype-technical-inspector"
          className="card flex flex-col gap-2.5 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="m-0 text-[14px] font-semibold text-foreground">
              {t('语义锚点与 HTML 源码检查 (MU)', 'MU Semantic Anchors & Raw HTML Source')}
            </h3>
            <span className="font-mono text-[12px] text-muted-foreground">
              {extractedMu
                ? `${extractedMu.screens.length} screens · ${extractedMu.screens.reduce((sum, s) => sum + s.events.length, 0)} events`
                : t('暂无原型源码', 'No prototype source yet')}
            </span>
          </div>

          {extractedMu && extractedMu.screens.length > 0 && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {extractedMu.screens.map((scr) => (
                <div
                  key={scr.screenId}
                  className="rounded-md border border-border bg-muted/40 p-2.5 text-[12px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-foreground">{scr.name}</strong>
                    <span className="font-mono text-muted-foreground">
                      {scr.screenId} ({scr.screenType})
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-muted-foreground">
                    {scr.elements.length > 0
                      ? scr.elements
                          .map(
                            (el) =>
                              `${el.elementId}${el.dataBinding ? ` -> ${el.dataBinding}` : ''}`,
                          )
                          .join(', ')
                      : t('未声明控件锚点', 'No element anchors')}
                  </div>
                </div>
              ))}
            </div>
          )}

          {proto && (
            <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px]">
              <summary className="cursor-pointer font-medium text-foreground select-none">
                {t(
                  `查看原始 HTML 源码 (${proto.htmlContent.length} chars)`,
                  `View raw HTML source (${proto.htmlContent.length} chars)`,
                )}
              </summary>
              <pre className="mt-2 max-h-[320px] overflow-auto rounded border border-border bg-card p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground">
                {proto.htmlContent}
              </pre>
            </details>
          )}
        </section>
      </div>
    );
  }

  // ─── Blocked State (Business View, Requirements not confirmed yet) ─────────
  if (isBlockedByUnconfirmedRequirements) {
    return (
      <div className="space-y-4" data-testid="prototype-step-canvas">
        <section
          className="card flex flex-col items-start gap-3 p-5"
          data-testid="prototype-blocked-state"
        >
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 font-title text-[18px] font-semibold text-foreground">
              {t('界面原型', 'Prototype')}
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="prototype-view-mode-toggle"
              onClick={() => setViewMode('technical')}
            >
              {t(
                BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
                BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
              )}
            </Button>
          </div>

          <p
            className="m-0 flex w-full items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2.5 text-[13px] text-muted-foreground"
            data-testid="prototype-status-banner"
            data-step-state="NOT_STARTED"
          >
            <CircleDot size={15} className="shrink-0 text-primary" aria-hidden="true" />
            <span>
              {t(
                '需要先在「需求」步骤确认需求文档，之后就可以在这里挑选参考界面并生成可交互原型。',
                'Confirm your requirements document in the Requirements step first, then pick visual references and generate an interactive prototype here.',
              )}
            </span>
          </p>
        </section>
      </div>
    );
  }

  // ─── Business View One-Sentence Status Summary ─────────────────────────────
  const statusSentence =
    currentStage === 'BRIEFING'
      ? prototypes.length > 0
        ? t(
            '可调整视觉参考、感受或交互示意，点击右侧「按新简报重做风格」即可生成新修订版本。',
            'Adjust visual references, feel, or interactions, then click Restyle from updated brief to create a new revision.',
          )
        : t(
            '先挑选一张喜欢的参考界面并核对右侧设计简报，点击「确认设计简报并生成原型」即可由 AI 助手生成首版原型。',
            'Pick a visual reference and review the Design Brief on the right, then click Confirm Brief & Generate Prototype.',
          )
      : stepState === 'CONFIRMED'
        ? t(
            '当前界面原型已确认，可继续前往下一步整理业务模型，或框选任意区域继续微调。',
            'This prototype is confirmed; continue to the Business Model step or box-select any area to refine further.',
          )
        : stepState === 'UNCONFIRMED_CHANGES'
          ? t(
              '当前原型包含未确认的新修订；点击画布右上角「重新确认原型」可预览界面变化并确认生效。',
              'This prototype has unconfirmed revisions; click Re-confirm prototype to review screen changes and confirm.',
            )
          : t(
              '界面原型已生成；可在左侧对话或框选局部继续打磨，核对无误后点击画布右上角「确认原型」。',
              'Your prototype is ready; refine it with the AI Assistant or box-select controls, then click Confirm prototype.',
            );

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="prototype-step-canvas"
      style={canvasFocusMode ? { animation: 'none', transform: 'none' } : undefined}
    >
      <input
        ref={htmlUploadRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={handleUploadHtml}
      />

      {isOutdated ? (
        <section
          className="card flex flex-wrap items-center justify-between gap-3 border-warning/45 bg-warning-soft/55 px-4 py-3"
          data-testid="prototype-outdated-banner"
          data-step-state="OUTDATED"
          role="region"
          aria-label={t('原型待更新提示', 'Prototype update notice')}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5 text-[13px] text-foreground">
            <Info size={16} className="shrink-0 text-warning" aria-hidden="true" />
            <span>
              {t(
                '需求有了新的确认；原型更新确认后，业务模型也会提示更新。',
                'Requirements were re-confirmed; once the prototype is updated and confirmed, the Business Model will also prompt for an update.',
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="prototype-view-mode-toggle"
              onClick={() => setViewMode('technical')}
            >
              {t(
                BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
                BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="prototype-confirm-as-is-btn"
              disabled={confirmingAsIs || isBusyProto}
              onClick={() => void handleConfirmPrototypeAsIs()}
            >
              <CheckCircle2 size={13.5} aria-hidden="true" />
              {t('不需要改动，按现状确认', 'Confirm as is without changes')}
            </Button>
            <Button
              type="button"
              variant="accent"
              size="sm"
              data-testid="prototype-ask-assistant-update-btn"
              disabled={isBusyProto || confirmingAsIs}
              onClick={() => void handleAskAssistantToUpdate()}
            >
              {isBusyProto ? (
                <Loader2 size={13.5} className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles size={13.5} aria-hidden="true" />
              )}
              {t('让 AI 助手更新', 'Update with AI Assistant')}
            </Button>
          </div>
        </section>
      ) : (
        !canvasFocusMode && (
          <section className="card flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <p
              className={cn(
                'm-0 flex min-w-0 flex-1 items-center gap-2 text-[13px]',
                stepState === 'CONFIRMED' ? 'text-foreground' : 'text-muted-foreground',
              )}
              data-testid="prototype-status-banner"
              data-step-state={stepState}
            >
              {stepState === 'CONFIRMED' ? (
                <CheckCircle2 size={15} className="shrink-0 text-success" aria-hidden="true" />
              ) : stepState === 'UNCONFIRMED_CHANGES' ? (
                <Info size={15} className="shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <CircleDot size={15} className="shrink-0 text-primary" aria-hidden="true" />
              )}
              <span>{statusSentence}</span>
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="prototype-view-mode-toggle"
                onClick={() => setViewMode('technical')}
              >
                {t(
                  BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
                  BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
                )}
              </Button>

              {currentStage === 'CANVAS' && stepState === 'CONFIRMED' && onNavigate && (
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  data-testid="go-to-business-model-btn"
                  onClick={() => onNavigate('app-ontology')}
                >
                  {t('去整理业务模型', 'Go to Business Model')}
                  <ArrowRight size={14} aria-hidden="true" />
                </Button>
              )}
            </div>
          </section>
        )
      )}

      {renderStageBody('business')}

      <ArtifactHistoryDrawer
        open={historyDrawerArtifactKind === 'PROTOTYPE'}
        onOpenChange={(open) => {
          if (!open) closeArtifactHistoryDrawer();
        }}
        artifactLabel={{ zh: '界面原型', en: 'Prototype' }}
        entries={(data.artifactHistory ?? []).filter(
          (e) => e.artifactKind === 'PROTOTYPE' && (!proto || e.targetId === proto.id),
        )}
        busyEntryId={historyBusyEntryId}
        onUndoLatest={async (entry) => {
          setHistoryBusyEntryId(entry.id);
          try {
            await undoArtifactChange('PROTOTYPE', entry.id, entry.targetId);
          } finally {
            setHistoryBusyEntryId(null);
          }
        }}
        onRestoreBefore={async (entry) => {
          setHistoryBusyEntryId(entry.id);
          try {
            await restoreArtifactBeforeChange('PROTOTYPE', entry.id);
          } finally {
            setHistoryBusyEntryId(null);
          }
        }}
        onJumpToTarget={(target) => {
          if (target.kind === 'PROTOTYPE_ANCHOR') {
            focusPrototypeTarget(target);
            useAgentPanelStore.getState().setHoveredAnchor({
              ...(target.screenId ? { screenId: target.screenId } : {}),
              ...(target.elementId ? { elementId: target.elementId } : {}),
            });
          }
        }}
      />
    </div>
  );
}
