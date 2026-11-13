import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Loader2,
  Send,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { TransientTurnImageInput } from '../../../packages/agent-runtime/index.js';
import type {
  AgentImageAttachmentRef,
  DesignBrief,
  DesignBriefItem,
  InteractivePrototype,
  ProjectDetail,
  PrototypeArtifact,
  RequirementDoc,
} from '../../../packages/workspace-store/index.js';
import { apiUpdatePrototypeDesignBrief, useWorkbenchStore } from '../../api.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { VisionAttachmentControls } from '../agent/VisionAttachmentControls.js';
import { Button } from '../beautifui/index.js';
import {
  DesignBriefCard,
  StyleTileCard,
  addDesignBriefItem,
  buildDesignBriefFromState,
  compileDesignBriefGenerationPrompt,
  compileDesignBriefRestylePrompt,
  decideDesignBriefForMe,
  deriveStyleTileTokens,
  gatherBriefingTurnImages,
  hydrateBriefingStateFromDesignBrief,
  removeDesignBriefItem,
  requestDesignBriefAssist,
  rewriteDesignBriefWithInstruction,
  updateDesignBriefItem,
} from './DesignBriefAndStyleTile.js';
import {
  MotionSchematicGallery,
  StyleTileMotionSampleStrip,
  inferDefaultAlignmentFromSrs,
  type RequirementAlignmentState,
} from './MotionSchematicGallery.js';
import type {
  PrototypeSelectionTarget,
  PrototypeVisualAnnotation,
} from './PrototypeVisualInspector.js';
import {
  CURATED_INSPO_CATALOG,
  LIKED_ASPECT_OPTIONS,
  VisualReferencePicker,
  createInitialVisualReferenceSelection,
  fetchVisualReferenceDesignSystem,
  inspoFullUrl,
  inspoHeroUrl,
  inspoMobileUrl,
  inspoThumbUrl,
  type BorrowedReferenceSelection,
  type LikedAspectKey,
  type SelectedInspoPreference,
  type VisualReferenceItem,
  type VisualReferenceSelection,
} from './VisualReferencePicker.js';

type BriefStep = 'REFERENCES' | 'FEEL' | 'MOTION';

/** Below this stage width the brief and style tile stack under the steps instead of beside them. */
const BRIEF_STAGE_SIDE_BY_SIDE_MIN_WIDTH = 1040;

export type InspoReferenceItem = VisualReferenceItem;

export {
  CURATED_INSPO_CATALOG,
  DesignBriefCard,
  LIKED_ASPECT_OPTIONS,
  StyleTileCard,
  StyleTileMotionSampleStrip,
  VisualReferencePicker,
  inspoFullUrl,
  inspoHeroUrl,
  inspoMobileUrl,
  inspoThumbUrl,
  type BorrowedReferenceSelection,
  type LikedAspectKey,
  type SelectedInspoPreference,
  type VisualReferenceItem,
  type VisualReferenceSelection,
};

export interface ConfirmBriefGeneratePayload {
  brief: DesignBrief;
  compiledPrompt: string;
  prototypeName: string;
  images: TransientTurnImageInput[];
  docId?: string;
}

export interface ConfirmBriefRestylePayload {
  prototypeId: string;
  brief: DesignBrief;
  compiledPrompt: string;
  images: TransientTurnImageInput[];
  docId?: string;
}

export interface PrototypeCoDesignStudioProps {
  project: ProjectDetail;
  docs: RequirementDoc[];
  selectedDocId: string;
  onSelectDocId: (docId: string) => void;
  prototypes: PrototypeArtifact[];
  activePrototype?: InteractivePrototype | undefined;
  onConfirmGenerateBrief?: (payload: ConfirmBriefGeneratePayload) => Promise<void>;
  onConfirmRestyleBrief?: (payload: ConfirmBriefRestylePayload) => Promise<void>;
  onGenerateWithAi?: (compiledPrompt: string, docId?: string) => Promise<void>;
  visionSupported?: boolean;
  visionProviderLabel?: string;
  onOpenLlmCenter?: () => void;
  onBackToCanvas?: () => void;
  onImportHtmlClick?: () => void;
  isBusyProto: boolean;
  // Legacy optional compatibility props for standalone callers
  selectedProtoId?: string;
  onSelectProtoId?: (id: string) => void;
  activeStep?: 1 | 2 | 3;
  onStepChange?: (step: 1 | 2 | 3) => void;
  previewSource?: 'REFERENCE_DRAFT' | 'SAVED_PROTO';
  onPreviewSourceChange?: (src: 'REFERENCE_DRAFT' | 'SAVED_PROTO') => void;
  savedHtmlContent?: string;
  onSavedHtmlContentChange?: (html: string) => void;
  onDraftHtmlChange?: (html: string, refTitleSummary: string) => void;
  onSaveDraftAsPrototype?: (html: string, refTitleSummary: string) => Promise<void>;
  onCloneVersion?: () => void;
  onDeleteProto?: (proto: PrototypeArtifact) => void;
  onDownloadHtml?: (html: string, name?: string) => void;
  inspectMode?: boolean;
  onInspectModeChange?: (next: boolean) => void;
  visualAnnotations?: PrototypeVisualAnnotation[];
  onAddVisualAnnotation?: (target: PrototypeSelectionTarget, note: string) => void;
  onRemoveVisualAnnotation?: (id: string) => void;
  onClearVisualAnnotations?: () => void;
  refineInstruction?: string;
  onRefineInstructionChange?: (val: string) => void;
  onApplyRefine?: (
    activeHtml: string,
    immediateDraft?: { target: PrototypeSelectionTarget; note: string },
  ) => Promise<void>;
}

export function PrototypeCoDesignStudio({
  project,
  docs,
  selectedDocId,
  onSelectDocId,
  prototypes,
  activePrototype,
  onConfirmGenerateBrief,
  onConfirmRestyleBrief,
  onGenerateWithAi,
  visionSupported = true,
  visionProviderLabel,
  onOpenLlmCenter,
  onBackToCanvas,
  onImportHtmlClick,
  isBusyProto,
}: PrototypeCoDesignStudioProps) {
  const { locale, t } = usePreferences();
  const patchData = useWorkbenchStore((s) => s.patchData);
  const referencesAnchorRef = useRef<HTMLDivElement | null>(null);
  const feelAnchorRef = useRef<HTMLElement | null>(null);
  const schematicsAnchorRef = useRef<HTMLDivElement | null>(null);

  const activeDoc = docs.find((d) => d.id === selectedDocId) ?? docs[0];

  const initialHydration = useMemo(() => {
    const baseAlignment = inferDefaultAlignmentFromSrs(activeDoc?.content, project);
    if (activePrototype?.designBrief) {
      const hydrated = hydrateBriefingStateFromDesignBrief(
        activePrototype.designBrief,
        CURATED_INSPO_CATALOG,
        baseAlignment,
      );
      return {
        referenceSelection: hydrated.referenceSelection,
        alignment: hydrated.alignment,
        userFeelNote: hydrated.userFeelNote,
        userImageRefs: hydrated.userImageRefs,
        manualBriefItems:
          activePrototype.designBrief.items.length > 0
            ? activePrototype.designBrief.items
            : null,
        alignmentTouched: true,
      };
    }
    return {
      referenceSelection: createInitialVisualReferenceSelection(CURATED_INSPO_CATALOG[0]!),
      alignment: baseAlignment,
      userFeelNote: '',
      userImageRefs: [] as AgentImageAttachmentRef[],
      manualBriefItems: null as DesignBriefItem[] | null,
      alignmentTouched: false,
    };
    // Hydrated once on initial render; subsequent changes handled in effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [referenceSelection, setReferenceSelection] = useState<VisualReferenceSelection>(
    initialHydration.referenceSelection,
  );
  const [alignmentTouched, setAlignmentTouched] = useState(initialHydration.alignmentTouched);
  const [alignment, setAlignmentState] = useState<RequirementAlignmentState>(
    initialHydration.alignment,
  );
  const [userFeelNote, setUserFeelNote] = useState<string>(initialHydration.userFeelNote);
  const [localAttachments, setLocalAttachments] = useState<AgentImageAttachmentRef[]>(
    initialHydration.userImageRefs,
  );
  const [manualBriefItems, setManualBriefItems] = useState<DesignBriefItem[] | null>(
    initialHydration.manualBriefItems,
  );
  const [customNoteDraft, setCustomNoteDraft] = useState('');
  // The brief is gathered in three short steps, one on screen at a time, instead of one long page.
  const [briefStep, setBriefStep] = useState<BriefStep>('REFERENCES');
  const stageRef = useRef<HTMLElement | null>(null);
  // Side-by-side only when the stage itself is wide; the Agent Panel can take half the window.
  const [stageWide, setStageWide] = useState(true);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setStageWide(width >= BRIEF_STAGE_SIDE_BY_SIDE_MIN_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [decidingForMe, setDecidingForMe] = useState(false);
  const [assistingBrief, setAssistingBrief] = useState(false);
  const [submittingBrief, setSubmittingBrief] = useState(false);

  const setAlignment: React.Dispatch<React.SetStateAction<RequirementAlignmentState>> = (
    updater,
  ) => {
    setAlignmentTouched(true);
    setAlignmentState(updater);
  };

  // Re-hydrate when returning from Canvas Stage with an activePrototype carrying a saved DesignBrief
  const hydratedProtoKeyRef = useRef<string>(
    activePrototype?.designBrief
      ? `${activePrototype.id}:${activePrototype.designBrief.updatedAt}`
      : '',
  );
  useEffect(() => {
    const nextKey = activePrototype?.designBrief
      ? `${activePrototype.id}:${activePrototype.designBrief.updatedAt}`
      : '';
    if (!nextKey || nextKey === hydratedProtoKeyRef.current) return;
    hydratedProtoKeyRef.current = nextKey;
    const baseAlignment = inferDefaultAlignmentFromSrs(activeDoc?.content, project);
    const hydrated = hydrateBriefingStateFromDesignBrief(
      activePrototype!.designBrief!,
      CURATED_INSPO_CATALOG,
      baseAlignment,
    );
    setReferenceSelection(hydrated.referenceSelection);
    setAlignmentState(hydrated.alignment);
    setAlignmentTouched(true);
    setUserFeelNote(hydrated.userFeelNote);
    setLocalAttachments(hydrated.userImageRefs);
    setManualBriefItems(
      activePrototype!.designBrief!.items.length > 0
        ? activePrototype!.designBrief!.items
        : null,
    );
  }, [activePrototype?.id, activePrototype?.designBrief?.updatedAt, activeDoc?.content, project]);

  useEffect(() => {
    if (!alignmentTouched && !activePrototype?.designBrief) {
      setAlignmentState(inferDefaultAlignmentFromSrs(activeDoc?.content, project));
    }
  }, [activeDoc?.id, activeDoc?.content, project, alignmentTouched, activePrototype?.designBrief]);

  // Initial agent-backed briefing synthesis when projectId is provided and no saved brief exists yet
  const initialAssistProjectRef = useRef<string>('');
  useEffect(() => {
    if (activePrototype?.designBrief || !project.id) return;
    if (initialAssistProjectRef.current === project.id) return;
    initialAssistProjectRef.current = project.id;
    let cancelled = false;
    void requestDesignBriefAssist({
      projectId: project.id,
      mode: 'synthesize',
      project,
      ...(activeDoc ? { doc: activeDoc } : {}),
      referenceSelection,
      visionImages: localAttachments,
    }).then((assisted) => {
      if (cancelled || !assisted) return;
      setManualBriefItems((prev) => prev ?? assisted.items);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, activePrototype?.id]);

  const handleAttachmentsChange = (next: AgentImageAttachmentRef[]) => {
    setLocalAttachments(next);
    if (!activePrototype?.id) return;
    const nextBrief = buildDesignBriefFromState({
      project,
      ...(activeDoc ? { doc: activeDoc } : {}),
      referenceSelection,
      alignment,
      userFeelNote,
      localAttachmentCount: next.length,
      userImageRefs: next,
      ...(manualBriefItems ? { existingItems: manualBriefItems } : {}),
      locale,
    });
    hydratedProtoKeyRef.current = `${activePrototype.id}:${nextBrief.updatedAt}`;
    void apiUpdatePrototypeDesignBrief(activePrototype.id, nextBrief)
      .then((res) => {
        if (res?.prototypes) {
          patchData({
            prototypes: res.prototypes,
            confirmedPrototypeRevision: res.confirmedRevision,
          });
        }
      })
      .catch(() => {
        // Offline / isolated unit test environments keep in-memory state intact
      });
  };

  const handleFeelNoteChange = (nextNote: string) => {
    setUserFeelNote(nextNote);
    setManualBriefItems((prev) => {
      if (!prev) return null;
      const trimmed = nextNote.trim();
      const withoutFeel = prev.filter((item) => item.id !== 'brief-user-feel');
      if (!trimmed) return withoutFeel;
      const feelStatement =
        locale === 'en-US'
          ? `User's plain-language feel requirement: "${trimmed}".`
          : `用户直白感受与重点关切：「${trimmed}」。`;
      return [
        ...withoutFeel,
        {
          id: 'brief-user-feel',
          category: 'user_feel',
          statement: feelStatement,
        },
      ];
    });
  };

  const styleTileTokens = useMemo(
    () => deriveStyleTileTokens(referenceSelection, alignment, userFeelNote),
    [referenceSelection, alignment, userFeelNote],
  );

  const activeBrief = useMemo(
    () =>
      buildDesignBriefFromState({
        project,
        ...(activeDoc ? { doc: activeDoc } : {}),
        referenceSelection,
        alignment,
        userFeelNote,
        localAttachmentCount: localAttachments.length,
        userImageRefs: localAttachments,
        ...(manualBriefItems ? { existingItems: manualBriefItems } : {}),
        locale,
      }),
    [
      project,
      activeDoc,
      referenceSelection,
      alignment,
      userFeelNote,
      localAttachments,
      manualBriefItems,
      locale,
    ],
  );

  const handleRefreshBrief = async () => {
    if (assistingBrief || isBusyProto || submittingBrief) return;
    if (!project.id) {
      setManualBriefItems(null);
      return;
    }
    setAssistingBrief(true);
    try {
      const assisted = await requestDesignBriefAssist({
        projectId: project.id,
        mode: 'synthesize',
        project,
        ...(activeDoc ? { doc: activeDoc } : {}),
        currentBrief: activeBrief,
        referenceSelection,
        visionImages: localAttachments,
      });
      setManualBriefItems(assisted ? assisted.items : null);
    } finally {
      setAssistingBrief(false);
    }
  };

  const handleDecideForMe = async () => {
    if (decidingForMe || isBusyProto || submittingBrief) return;
    setDecidingForMe(true);
    try {
      const decided = await decideDesignBriefForMe({
        project,
        ...(activeDoc ? { doc: activeDoc } : {}),
        catalog: CURATED_INSPO_CATALOG,
        userFeelNote,
        localAttachmentCount: localAttachments.length,
        locale,
      });
      setReferenceSelection(decided.referenceSelection);
      setAlignmentState(decided.alignment);
      setAlignmentTouched(true);
      const assisted = await requestDesignBriefAssist({
        projectId: project.id,
        mode: 'decide',
        project,
        ...(activeDoc ? { doc: activeDoc } : {}),
        currentBrief: decided.brief,
        referenceSelection: decided.referenceSelection,
        visionImages: localAttachments,
      });
      setManualBriefItems(assisted ? assisted.items : null);
    } finally {
      setDecidingForMe(false);
    }
  };

  const handleOneSentenceRewrite = async (instruction: string) => {
    const res = rewriteDesignBriefWithInstruction({
      brief: activeBrief,
      instruction,
      referenceSelection,
      alignment,
      project,
      ...(activeDoc ? { doc: activeDoc } : {}),
      catalog: CURATED_INSPO_CATALOG,
      locale,
    });
    setReferenceSelection(res.nextReferenceSelection);
    setAlignmentState(res.nextAlignment);
    setAlignmentTouched(true);
    if (res.brief.userFeelNote !== undefined) {
      setUserFeelNote(res.brief.userFeelNote);
    }
    setManualBriefItems(res.brief.items);

    if (!project.id) return;
    setAssistingBrief(true);
    try {
      const assisted = await requestDesignBriefAssist({
        projectId: project.id,
        mode: 'rewrite',
        instruction,
        project,
        ...(activeDoc ? { doc: activeDoc } : {}),
        currentBrief: res.brief,
        referenceSelection: res.nextReferenceSelection,
        visionImages: localAttachments,
      });
      if (assisted) {
        setManualBriefItems(assisted.items);
      }
    } finally {
      setAssistingBrief(false);
    }
  };

  const handleConfirmGenerate = async () => {
    if (isBusyProto || submittingBrief) return;
    setSubmittingBrief(true);
    try {
      const [designSys, images] = await Promise.all([
        fetchVisualReferenceDesignSystem(referenceSelection.primary.slug),
        gatherBriefingTurnImages({
          referenceSelection,
          localAttachments,
          locale,
        }),
      ]);
      const now = new Date().toISOString();
      const approvedBrief: DesignBrief = {
        ...activeBrief,
        approvedAt: now,
        updatedAt: now,
      };
      const compiledPrompt = compileDesignBriefGenerationPrompt({
        project,
        ...(activeDoc ? { doc: activeDoc } : {}),
        brief: approvedBrief,
        referenceSelection,
        alignment,
        designSystemMarkdown: designSys.markdown,
        locale,
      });
      const prototypeName =
        prototypes.length === 0
          ? t(`${project.name} · 交互原型`, `${project.name} · Prototype`)
          : t(
              `${project.name} · 交互原型 V${prototypes.length + 1}`,
              `${project.name} · Prototype V${prototypes.length + 1}`,
            );

      if (onConfirmGenerateBrief) {
        await onConfirmGenerateBrief({
          brief: approvedBrief,
          compiledPrompt,
          prototypeName,
          images,
          ...(activeDoc ? { docId: activeDoc.id } : {}),
        });
      } else if (onGenerateWithAi) {
        await onGenerateWithAi(compiledPrompt, activeDoc?.id);
      }
    } finally {
      setSubmittingBrief(false);
    }
  };

  const handleConfirmRestyle = async () => {
    if (!activePrototype || isBusyProto || submittingBrief) return;
    setSubmittingBrief(true);
    try {
      const [designSys, images] = await Promise.all([
        fetchVisualReferenceDesignSystem(referenceSelection.primary.slug),
        gatherBriefingTurnImages({
          referenceSelection,
          localAttachments,
          locale,
        }),
      ]);
      const now = new Date().toISOString();
      const approvedBrief: DesignBrief = {
        ...activeBrief,
        approvedAt: now,
        updatedAt: now,
      };
      const compiledPrompt = compileDesignBriefRestylePrompt({
        project,
        ...(activeDoc ? { doc: activeDoc } : {}),
        brief: approvedBrief,
        referenceSelection,
        alignment,
        designSystemMarkdown: designSys.markdown,
        locale,
      });

      if (onConfirmRestyleBrief) {
        await onConfirmRestyleBrief({
          prototypeId: activePrototype.id,
          brief: approvedBrief,
          compiledPrompt,
          images,
          ...(activeDoc ? { docId: activeDoc.id } : {}),
        });
      } else if (onGenerateWithAi) {
        await onGenerateWithAi(compiledPrompt, activeDoc?.id);
      }
    } finally {
      setSubmittingBrief(false);
    }
  };

  const effectiveBusy = isBusyProto || submittingBrief;

  const goToBriefStep = (step: BriefStep) => {
    setBriefStep(step);
    stageRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const feelProvided = localAttachments.length > 0 || userFeelNote.trim().length > 0;
  const briefSteps: { id: BriefStep; label: string; status: string }[] = [
    {
      id: 'REFERENCES',
      label: t('视觉参考', 'Visual Reference'),
      status: referenceSelection.primary.title,
    },
    {
      id: 'FEEL',
      label: t('我的参考与感受', 'My Images & Feel'),
      status: feelProvided
        ? localAttachments.length > 0
          ? t(`${localAttachments.length} 张图`, `${localAttachments.length} image${localAttachments.length === 1 ? '' : 's'}`)
          : t('已填写', 'Filled in')
        : t('选填', 'Optional'),
    },
    {
      id: 'MOTION',
      label: t('交互示意', 'Interactions'),
      status: alignmentTouched ? t('已调整', 'Adjusted') : t('已按需求预选', 'Preselected'),
    },
  ];

  return (
    <section
      ref={stageRef}
      data-testid="prototype-briefing-stage"
      aria-label={t('界面原型简报工作区', 'Prototype Design Brief Stage')}
      className="flex flex-col gap-3.5"
    >
      {/* ─── Single-Page Briefing Stage Header ─── */}
      <header
        data-testid="prototype-briefing-header"
        className="card flex flex-wrap items-center justify-between gap-3 py-3"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[15px] font-semibold text-ink">
              {t('设计简报', 'Design Brief')}
            </h2>
            <span className="badge font-mono text-[11px]">
              {t(
                `主参考 ${referenceSelection.primary.title}${referenceSelection.borrowed.length > 0 ? ` + ${referenceSelection.borrowed.length} 借鉴` : ''}`,
                `Primary: ${referenceSelection.primary.title}${referenceSelection.borrowed.length > 0 ? ` +${referenceSelection.borrowed.length}` : ''}`,
              )}
            </span>
          </div>
          <p className="m-0 mt-0.5 text-[12px] text-ink-3">
            {t(
              '选好参考、说清感受、点选交互方式，风格样张会实时预演；确认后由共创智能体生成可交互原型。',
              'Pick a reference, describe the feel, choose interactions, and watch the Style Tile update; then the agent builds the prototype.',
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {prototypes.length > 0 && onBackToCanvas && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="prototype-back-to-canvas-btn"
              onClick={onBackToCanvas}
            >
              <ArrowLeft size={13.5} aria-hidden="true" />
              {t(
                `返回画布 (${prototypes.length})`,
                `Back to Canvas (${prototypes.length})`,
              )}
            </Button>
          )}
          {onImportHtmlClick && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="briefing-import-html-btn"
              onClick={onImportHtmlClick}
            >
              <Upload size={13.5} aria-hidden="true" />
              {t('导入 HTML', 'Import HTML')}
            </Button>
          )}
          <Button
            type="button"
            variant="accent"
            size="sm"
            data-testid="briefing-generate-prototype-btn"
            disabled={effectiveBusy}
            onClick={() =>
              void (activePrototype && onConfirmRestyleBrief
                ? handleConfirmRestyle()
                : handleConfirmGenerate())
            }
          >
            {effectiveBusy ? (
              <Loader2 size={13.5} className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles size={13.5} aria-hidden="true" />
            )}
            {activePrototype && onConfirmRestyleBrief
              ? t('按新简报重做风格', 'Restyle from updated brief')
              : t('确认设计简报并生成原型', 'Confirm Brief & Generate Prototype')}
          </Button>
        </div>
      </header>

      {/* ─── Single-Page Side-by-Side Briefing Stage Grid ─── */}
      <div
        className={cn(
          'grid items-start gap-4',
          stageWide ? 'grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)]' : 'grid-cols-1',
        )}
        data-layout={stageWide ? 'side-by-side' : 'stacked'}
      >
        {/* Left Column: one step at a time — references, your own images & feel, interaction schematics */}
        <div data-testid="briefing-left-column" className="flex min-w-0 flex-col gap-3">
          <div
            role="tablist"
            aria-label={t('设计简报步骤', 'Design Brief steps')}
            data-testid="briefing-step-tabs"
            className="brief-steps"
          >
            {briefSteps.map((step, idx) => (
              <button
                key={step.id}
                id={`brief-step-tab-${step.id}`}
                type="button"
                role="tab"
                aria-selected={briefStep === step.id}
                aria-controls={`brief-step-panel-${step.id}`}
                tabIndex={briefStep === step.id ? 0 : -1}
                data-testid={`briefing-step-${step.id}`}
                className="brief-step"
                onClick={() => setBriefStep(step.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  const next =
                    briefSteps[
                      (idx + (e.key === 'ArrowRight' ? 1 : -1) + briefSteps.length) %
                        briefSteps.length
                    ]!;
                  setBriefStep(next.id);
                  document.getElementById(`brief-step-tab-${next.id}`)?.focus();
                }}
              >
                <span className="brief-step-index" aria-hidden="true">
                  {idx + 1}
                </span>
                <span className="brief-step-text">
                  <span className="brief-step-label">{step.label}</span>
                  <span className="brief-step-status">{step.status}</span>
                </span>
              </button>
            ))}
          </div>

          <div
            ref={referencesAnchorRef}
            id="brief-step-panel-REFERENCES"
            role="tabpanel"
            aria-labelledby="brief-step-tab-REFERENCES"
            hidden={briefStep !== 'REFERENCES'}
          >
            <VisualReferencePicker
              selection={referenceSelection}
              onSelectionChange={setReferenceSelection}
              projectId={project.id}
              {...(activeDoc ? { docId: activeDoc.id } : {})}
              onContinue={() => goToBriefStep('FEEL')}
              continueLabelZh="下一步：我的参考与感受"
              continueLabelEn="Next: My Images & Feel"
            />
          </div>

          <section
            ref={feelAnchorRef}
            id="brief-step-panel-FEEL"
            role="tabpanel"
            hidden={briefStep !== 'FEEL'}
            data-testid="user-feel-and-uploads-card"
            aria-label={t(
              '您自己的参考图与直白感受说明',
              'Your Reference Images & Plain-Language Feel',
            )}
            className={cn('card flex-col gap-3', briefStep === 'FEEL' ? 'flex' : 'hidden')}
          >
            <div className="border-b border-line pb-2.5">
              <div className="flex items-center gap-2">
                <ImagePlus size={15} className="text-accent" />
                <h3 className="m-0 text-[14.5px] font-semibold text-ink">
                  {t(
                    '上传自己的参考图与直白感受描述（选填）',
                    'Your Own Reference Images & Plain-Language Feel (Optional)',
                  )}
                </h3>
              </div>
              <p className="m-0 mt-0.5 text-[12px] text-ink-3">
                {t(
                  '可直接上传或粘贴手头喜欢的系统截图（仅保存在当前浏览器本机存储），并用大白话描述想要的整体气质与重点关切。',
                  'Upload or paste screenshots from your clipboard (persisted in browser-local storage) and describe the desired feel in plain words.',
                )}
              </p>
            </div>

            <VisionAttachmentControls
              attachments={localAttachments}
              onAttachmentsChange={handleAttachmentsChange}
              visionSupported={visionSupported}
              {...(visionProviderLabel ? { providerLabel: visionProviderLabel } : {})}
              {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
              defaultRole="user_upload"
              disabled={effectiveBusy}
            />

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="user-feel-note-textarea"
                className="text-[12px] font-semibold text-ink-2"
              >
                {t(
                  '用大白话写下想要的整体感觉或盯紧的重点：',
                  'Describe the feel and priorities in plain language:',
                )}
              </label>
              <textarea
                id="user-feel-note-textarea"
                data-testid="user-feel-note-input"
                rows={3}
                className="input w-full bg-surface text-[12.5px] leading-relaxed"
                placeholder={t(
                  '例如：想要像银行内部台账那样稳重紧凑、一眼看清待审批金额，状态标签一眼分清通过还是退回…',
                  'e.g., Steady and compact like an internal bank ledger, with pending approval amounts clear at a glance…',
                )}
                value={userFeelNote}
                onChange={(e) => handleFeelNoteChange(e.target.value)}
              />
            </div>

            <div className="flex justify-end border-t border-line-soft pt-3">
              <Button type="button" variant="accent" size="sm" onClick={() => goToBriefStep('MOTION')}>
                {t('下一步：交互示意', 'Next: Interactions')}
                <ArrowRight size={13.5} aria-hidden="true" />
              </Button>
            </div>
          </section>

          <div
            ref={schematicsAnchorRef}
            id="brief-step-panel-MOTION"
            role="tabpanel"
            aria-labelledby="brief-step-tab-MOTION"
            hidden={briefStep !== 'MOTION'}
            className={cn('card flex-col gap-4', briefStep === 'MOTION' ? 'flex' : 'hidden')}
          >
            <MotionSchematicGallery
              alignment={alignment}
              setAlignment={setAlignment}
              accentColor={styleTileTokens.accentHex}
              palette={{
                accentColor: styleTileTokens.accentHex,
                surfaceColor: styleTileTokens.surfaceHex,
                inkColor: styleTileTokens.inkHex,
                radiusPx: styleTileTokens.radiusPx,
              }}
              {...(activeDoc ? { srsMarkdown: activeDoc.content } : {})}
              project={project}
            />

            <div className="rounded-card border border-line bg-inset/45 p-3.5">
              <div className="mb-2 text-[13px] font-semibold text-ink">
                {t(
                  '补充业务场景或页面细节（选填）',
                  'Extra business details for the Agent (Optional)',
                )}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!customNoteDraft.trim()) return;
                  setAlignment((prev) => ({
                    ...prev,
                    customNotes: [...prev.customNotes, customNoteDraft.trim()],
                  }));
                  setCustomNoteDraft('');
                }}
              >
                <input
                  className="input flex-1 bg-surface"
                  placeholder={t(
                    '例如：超过 10 万金额标红预警、列表增加「所属部门」筛选…',
                    'e.g., Highlight amounts over 100k in red, add a Department filter…',
                  )}
                  value={customNoteDraft}
                  onChange={(e) => setCustomNoteDraft(e.target.value)}
                />
                <Button type="submit" variant="secondary" size="sm">
                  <Send size={13} />
                  {t('添加备注', 'Add Note')}
                </Button>
              </form>

              {alignment.customNotes.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {alignment.customNotes.map((n, idx) => (
                    <span
                      key={`${idx}-${n}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[12px] text-ink"
                    >
                      <span>✓ {n}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAlignment((prev) => ({
                            ...prev,
                            customNotes: prev.customNotes.filter((_, i) => i !== idx),
                          }))
                        }
                        className="cursor-pointer text-ink-3 hover:text-red"
                      >
                        <X size={11.5} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (Sticky): 1. Editable Design Brief Card, 2. Real-Time Style Tile Card */}
        <div
          data-testid="briefing-right-column"
          className={cn('flex min-w-0 flex-col gap-4', stageWide && 'sticky top-3')}
        >
          <DesignBriefCard
            brief={activeBrief}
            {...(activePrototype ? { activePrototype } : {})}
            docs={docs}
            selectedDocId={selectedDocId}
            onSelectDocId={onSelectDocId}
            onUpdateItem={(itemId, statement) =>
              setManualBriefItems(updateDesignBriefItem(activeBrief, itemId, statement).items)
            }
            onAddItem={(statement) =>
              setManualBriefItems(addDesignBriefItem(activeBrief, statement).items)
            }
            onRemoveItem={(itemId) =>
              setManualBriefItems(removeDesignBriefItem(activeBrief, itemId).items)
            }
            onRemoveImageRef={(imageId) =>
              handleAttachmentsChange(localAttachments.filter((a) => a.id !== imageId))
            }
            onResetAutoBrief={handleRefreshBrief}
            onOneSentenceRewrite={handleOneSentenceRewrite}
            onDecideForMe={handleDecideForMe}
            onConfirmGenerate={handleConfirmGenerate}
            {...(activePrototype ? { onConfirmRestyle: handleConfirmRestyle } : {})}
            decidingForMe={decidingForMe}
            assistingBrief={assistingBrief}
            isBusy={effectiveBusy}
            visionSupported={visionSupported}
            {...(visionProviderLabel ? { visionProviderLabel } : {})}
            {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
          />

          <StyleTileCard
            tokens={styleTileTokens}
            referenceSelection={referenceSelection}
            alignment={alignment}
            project={project}
            {...(activeDoc ? { srsMarkdown: activeDoc.content } : {})}
          />
        </div>
      </div>
    </section>
  );
}
