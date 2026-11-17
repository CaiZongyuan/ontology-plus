import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  apiListPrototypes,
  useWorkbenchStore,
} from '../../api.js';
import { useAgentPanelStore } from '../../components/agent/agentPanelStore.js';
import { resolveActiveVisionCapability } from '../../components/agent/VisionAttachmentControls.js';
import { Button } from '../../components/beautifui/index.js';
import {
  PrototypeCanvasStage,
  runImportPrototypeHtml,
  type PrototypeCanvasStageProps,
} from '../../components/prototype/PrototypeCanvasStage.js';
import { decideDesignBriefForMe } from '../../components/prototype/DesignBriefAndStyleTile.js';
import { PrototypeCoDesignStudio } from '../../components/prototype/PrototypeCoDesignStudio.js';
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
        />
      )}
    </div>
  );
}
