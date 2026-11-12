import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Crosshair,
  ExternalLink,
  History,
  Laptop,
  Maximize2,
  Minimize2,
  PanelRightOpen,
  RotateCcw,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ConfirmedPrototypeRevision,
  InteractivePrototype,
  ProjectDetail,
  PrototypeRevision,
  PrototypeTargetAnchor,
} from '../../../packages/workspace-store/index.js';
import {
  apiClonePrototype,
  apiConfirmPrototypeRevision,
  apiDeletePrototype,
  apiRestorePrototypeRevision,
  apiSavePrototype,
  apiUpdatePrototypeRevisionMeta,
} from '../../api.js';
import {
  ConfirmRevisionMuDiffModal,
  PrototypeRevisionHistoryDrawer,
} from './PrototypeRevisionHistory.js';
import { useAgentPanelOverlayMode } from '../agent/ShellAgentPanel.js';
import { useAgentPanelStore } from '../agent/agentPanelStore.js';
import { Button } from '../beautifui/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  PrototypeVisualPreviewStage,
  computeViewportFitScale,
  openCleanPrototypeInNewTab,
  stripVisualInspectorFromHtml,
  type PrototypeSelectionCropPayload,
  type PrototypeSelectionTarget,
  type PrototypeViewportPreset,
  type PrototypeVisualAnnotation,
  type PrototypeZoomMode,
} from './PrototypeVisualInspector.js';
import { resolveHighlightSelectorFromAnchor } from './prototypeSelectionStore.js';

export interface RevisionHistorySlotProps {
  prototype: InteractivePrototype;
  activeRevision: PrototypeRevision;
  previewRevisionId: string | null;
  confirmedRevision: ConfirmedPrototypeRevision | null;
  onPreviewRevision: (revisionId: string | null) => void;
  onRestoreRevision: (revisionId: string) => Promise<void>;
  onClose: () => void;
}

export interface ConfirmRevisionSlotProps {
  project: ProjectDetail;
  prototype: InteractivePrototype;
  revision: PrototypeRevision;
  confirmedRevision: ConfirmedPrototypeRevision | null;
  onConfirmed: (result: {
    confirmedRevision: ConfirmedPrototypeRevision;
    prototype: InteractivePrototype;
    project: ProjectDetail;
    prototypes: InteractivePrototype[];
  }) => void;
  onClose: () => void;
}

export type PrototypeSwitcherSubPanel = 'NONE' | 'IMPORT_HTML' | 'CLONE' | 'DELETE';

export interface PrototypeCanvasStageProps {
  project: ProjectDetail;
  prototypes: InteractivePrototype[];
  selectedPrototypeId: string;
  confirmedRevision: ConfirmedPrototypeRevision | null;
  onSelectPrototype: (prototypeId: string) => void;
  onPrototypesUpdated: (payload: {
    prototypes: InteractivePrototype[];
    confirmedRevision?: ConfirmedPrototypeRevision | null;
    project?: ProjectDetail;
    selectedPrototypeId?: string;
  }) => void;
  onBackToBrief: () => void;
  onNotify?: (message: string) => void;
  onSynthesizeOntology?: (prototypeId: string) => void;
  synthesizingOntology?: boolean;

  // Box-Select & Ticket 06 (Selection Attachment Cards / Hover Highlight / Before-After) seams
  inspectMode?: boolean;
  defaultInspectMode?: boolean;
  onInspectModeChange?: (next: boolean) => void;
  onSelectTarget?: (
    target: PrototypeSelectionTarget,
    crop?: PrototypeSelectionCropPayload | null,
  ) => void;
  onSelectionCropUpgrade?: (cssSelector: string, crop: PrototypeSelectionCropPayload) => void;
  annotations?: PrototypeVisualAnnotation[];
  onAddAnnotation?: (target: PrototypeSelectionTarget, note: string) => void;
  onApplyImmediate?: (target: PrototypeSelectionTarget, note: string) => void;
  highlightedSelector?: string | null;
  activeRunningAnchor?: PrototypeTargetAnchor | null;
  flashedAnchors?: PrototypeTargetAnchor[];
  flashKey?: string | null;
  showInlineInspectorPopover?: boolean;
  canvasBannerSlot?: React.ReactNode;
  htmlOverride?: string | null;
  busy?: boolean;

  // Viewport, Zoom & Focus Mode (controlled or uncontrolled)
  viewport?: PrototypeViewportPreset;
  defaultViewport?: PrototypeViewportPreset;
  onViewportChange?: (viewport: PrototypeViewportPreset) => void;
  zoomMode?: PrototypeZoomMode;
  defaultZoomMode?: PrototypeZoomMode;
  onZoomModeChange?: (zoomMode: PrototypeZoomMode) => void;
  focusMode?: boolean;
  defaultFocusMode?: boolean;
  onFocusModeChange?: (focusMode: boolean) => void;
  containerWidthOverride?: number;

  // Initial / controlled UI sub-states
  defaultSwitcherOpen?: boolean;
  defaultSwitcherSubPanel?: PrototypeSwitcherSubPanel;
  defaultDeleteError?: string | null;
  defaultHistoryOpen?: boolean;
  defaultConfirmModalOpen?: boolean;
  previewRevisionId?: string | null;
  onPreviewRevisionIdChange?: (revisionId: string | null) => void;

  // Ticket 04 Revision History & MU-Diff Confirmation slots
  renderRevisionHistory?: (props: RevisionHistorySlotProps) => React.ReactNode;
  renderConfirmModal?: (props: ConfirmRevisionSlotProps) => React.ReactNode;
  onRequestConfirmRevision?: (
    prototype: InteractivePrototype,
    revision: PrototypeRevision,
  ) => void;
}

export function resolveRevisionStatusSummary(
  prototype: InteractivePrototype,
  activeRevision: PrototypeRevision,
  confirmedRevision: ConfirmedPrototypeRevision | null,
  locale: 'zh-CN' | 'en-US',
): { isConfirmed: boolean; aheadCount: number; badgeText: string } {
  const confirmedRevId = confirmedRevision?.revisionId ?? prototype.confirmedRevisionId;
  if (confirmedRevId && confirmedRevId === activeRevision.id) {
    return {
      isConfirmed: true,
      aheadCount: 0,
      badgeText: locale === 'en-US' ? 'Confirmed' : '已确认',
    };
  }

  if (confirmedRevId) {
    const confirmedIdx = prototype.revisions.findIndex((r) => r.id === confirmedRevId);
    const activeIdx = prototype.revisions.findIndex((r) => r.id === activeRevision.id);
    if (confirmedIdx >= 0 && activeIdx > confirmedIdx) {
      const ahead = activeIdx - confirmedIdx;
      return {
        isConfirmed: false,
        aheadCount: ahead,
        badgeText:
          locale === 'en-US' ? `${ahead} ahead of confirmed` : `领先已确认 ${ahead} 条`,
      };
    }
    if (confirmedIdx >= 0 && activeIdx >= 0 && activeIdx < confirmedIdx) {
      return {
        isConfirmed: false,
        aheadCount: 0,
        badgeText: locale === 'en-US' ? 'Earlier revision' : '历史修订',
      };
    }
  }

  if (
    activeRevision.id === prototype.currentRevisionId &&
    prototype.aheadOfConfirmedCount > 0
  ) {
    return {
      isConfirmed: false,
      aheadCount: prototype.aheadOfConfirmedCount,
      badgeText:
        locale === 'en-US'
          ? `${prototype.aheadOfConfirmedCount} ahead of confirmed`
          : `领先已确认 ${prototype.aheadOfConfirmedCount} 条`,
    };
  }

  return {
    isConfirmed: false,
    aheadCount: 0,
    badgeText: locale === 'en-US' ? 'Unconfirmed' : '未确认',
  };
}

export async function runImportPrototypeHtml(
  projectId: string,
  name: string,
  rawHtmlContent: string,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) {
  const cleanHtml = stripVisualInspectorFromHtml(rawHtmlContent).trim();
  if (!cleanHtml) return null;
  const fallbackName = locale === 'en-US' ? 'Imported Prototype.html' : '导入原型.html';
  const title = locale === 'en-US' ? 'Imported HTML prototype' : '导入外部 HTML 原型';
  return apiSavePrototype(projectId, {
    name: name.trim() || fallbackName,
    htmlContent: cleanHtml,
    source: 'UPLOADED',
    title,
  });
}

export async function runClonePrototypeAsNew(
  prototypeId: string,
  basePrototypeName: string,
  customName: string,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) {
  const fallback =
    locale === 'en-US' ? `${basePrototypeName} (Copy)` : `${basePrototypeName} (新方向)`;
  const targetName = customName.trim() || fallback;
  return apiClonePrototype(prototypeId, { name: targetName });
}

export async function runDeletePrototypeSafely(
  prototypeId: string,
  projectId: string,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
): Promise<
  | {
      ok: true;
      deletedId: string;
      prototypes: InteractivePrototype[];
      confirmedRevision: ConfirmedPrototypeRevision | null;
    }
  | {
      ok: false;
      errorMessage: string;
      code?: string;
    }
> {
  try {
    const res = await apiDeletePrototype(prototypeId, projectId);
    return {
      ok: true,
      deletedId: res.deletedId,
      prototypes: res.prototypes,
      confirmedRevision: res.confirmedRevision,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : locale === 'en-US'
          ? 'Failed to delete prototype'
          : '删除原型失败';
    const code =
      err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
        ? ((err as { code: string }).code)
        : undefined;
    return {
      ok: false,
      errorMessage,
      ...(code ? { code } : {}),
    };
  }
}

export function computeFocusModeRightOffset(
  focusMode: boolean,
  agentPanelOpen: boolean,
  agentPanelOverlay: boolean,
  agentPanelWidth: number,
): string {
  if (!focusMode) return '0px';
  return agentPanelOpen && !agentPanelOverlay ? `${agentPanelWidth}px` : '0px';
}

export function toggleShellAgentPanelFromCanvas(agentPanelOverlay: boolean): void {
  const store = useAgentPanelStore.getState();
  if (agentPanelOverlay) {
    store.setOverlayOpen(!store.overlayOpen);
  } else {
    store.setOpen(!store.open);
  }
}

export function registerFocusModeEscapeListener(
  target: {
    addEventListener: (
      type: 'keydown',
      listener: (e: { key: string; preventDefault: () => void }) => void,
    ) => void;
    removeEventListener: (
      type: 'keydown',
      listener: (e: { key: string; preventDefault: () => void }) => void,
    ) => void;
  },
  options: {
    switcherOpen: boolean;
    confirmModalOpen: boolean;
    onCloseSwitcher: () => void;
    onCloseConfirmModal: () => void;
    onExitFocusMode: () => void;
  },
): () => void {
  const onKeyDown = (e: { key: string; preventDefault: () => void }) => {
    if (e.key !== 'Escape') return;
    if (options.switcherOpen) {
      options.onCloseSwitcher();
      return;
    }
    if (options.confirmModalOpen) {
      options.onCloseConfirmModal();
      return;
    }
    e.preventDefault();
    options.onExitFocusMode();
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

export function PrototypeCanvasStage({
  project,
  prototypes,
  selectedPrototypeId,
  confirmedRevision,
  onSelectPrototype,
  onPrototypesUpdated,
  onBackToBrief,
  onNotify,
  onSynthesizeOntology,
  synthesizingOntology = false,
  inspectMode: controlledInspectMode,
  defaultInspectMode = false,
  onInspectModeChange,
  onSelectTarget,
  onSelectionCropUpgrade,
  annotations,
  onAddAnnotation,
  onApplyImmediate,
  highlightedSelector = null,
  activeRunningAnchor = null,
  flashedAnchors,
  flashKey = null,
  showInlineInspectorPopover,
  canvasBannerSlot,
  htmlOverride = null,
  busy = false,
  viewport: controlledViewport,
  defaultViewport = 'DESKTOP',
  onViewportChange,
  zoomMode: controlledZoomMode,
  defaultZoomMode = 'FIT',
  onZoomModeChange,
  focusMode: controlledFocusMode,
  defaultFocusMode = false,
  onFocusModeChange,
  containerWidthOverride,
  defaultSwitcherOpen = false,
  defaultSwitcherSubPanel = 'NONE',
  defaultDeleteError = null,
  defaultHistoryOpen = false,
  defaultConfirmModalOpen = false,
  previewRevisionId: controlledPreviewRevId,
  onPreviewRevisionIdChange,
  renderRevisionHistory,
  renderConfirmModal,
  onRequestConfirmRevision,
}: PrototypeCanvasStageProps) {
  const { locale, t } = usePreferences();
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importNameId = useId();
  const importHtmlId = useId();
  const cloneNameId = useId();

  const agentPanelOverlay = useAgentPanelOverlayMode();
  const agentPanelOpen = useAgentPanelStore((s) => s.open);
  const agentPanelOverlayOpen = useAgentPanelStore((s) => s.overlayOpen);
  const agentPanelWidth = useAgentPanelStore((s) => s.width);
  const hoveredAnchor = useAgentPanelStore((s) => s.hoveredAnchor);
  const effectiveHighlightedSelector =
    highlightedSelector ?? resolveHighlightSelectorFromAnchor(hoveredAnchor);

  const agentPanelVisible = agentPanelOverlay ? agentPanelOverlayOpen : agentPanelOpen;
  const toggleShellAgentPanel = useCallback(() => {
    toggleShellAgentPanelFromCanvas(agentPanelOverlay);
  }, [agentPanelOverlay]);

  const [uncontrolledViewport, setUncontrolledViewport] =
    useState<PrototypeViewportPreset>(defaultViewport);
  const [uncontrolledZoomMode, setUncontrolledZoomMode] =
    useState<PrototypeZoomMode>(defaultZoomMode);
  const [uncontrolledFocusMode, setUncontrolledFocusMode] = useState<boolean>(defaultFocusMode);
  const [uncontrolledInspectMode, setUncontrolledInspectMode] =
    useState<boolean>(defaultInspectMode);
  const [uncontrolledPreviewRevId, setUncontrolledPreviewRevId] = useState<string | null>(null);

  const viewport = controlledViewport ?? uncontrolledViewport;
  const zoomMode = controlledZoomMode ?? uncontrolledZoomMode;
  const focusMode = controlledFocusMode ?? uncontrolledFocusMode;
  const inspectMode = controlledInspectMode ?? uncontrolledInspectMode;
  const previewRevisionId =
    controlledPreviewRevId !== undefined ? controlledPreviewRevId : uncontrolledPreviewRevId;

  const setViewport = useCallback(
    (next: PrototypeViewportPreset) => {
      if (controlledViewport === undefined) setUncontrolledViewport(next);
      onViewportChange?.(next);
    },
    [controlledViewport, onViewportChange],
  );

  const setZoomMode = useCallback(
    (next: PrototypeZoomMode) => {
      if (controlledZoomMode === undefined) setUncontrolledZoomMode(next);
      onZoomModeChange?.(next);
    },
    [controlledZoomMode, onZoomModeChange],
  );

  const setFocusMode = useCallback(
    (next: boolean) => {
      if (controlledFocusMode === undefined) setUncontrolledFocusMode(next);
      onFocusModeChange?.(next);
    },
    [controlledFocusMode, onFocusModeChange],
  );

  const setInspectMode = useCallback(
    (next: boolean) => {
      if (controlledInspectMode === undefined) setUncontrolledInspectMode(next);
      onInspectModeChange?.(next);
    },
    [controlledInspectMode, onInspectModeChange],
  );

  const setPreviewRevisionId = useCallback(
    (next: string | null) => {
      if (controlledPreviewRevId === undefined) setUncontrolledPreviewRevId(next);
      onPreviewRevisionIdChange?.(next);
    },
    [controlledPreviewRevId, onPreviewRevisionIdChange],
  );

  const [switcherOpen, setSwitcherOpen] = useState<boolean>(defaultSwitcherOpen);
  const [switcherSubPanel, setSwitcherSubPanel] =
    useState<PrototypeSwitcherSubPanel>(defaultSwitcherSubPanel);
  const [historyOpen, setHistoryOpen] = useState<boolean>(defaultHistoryOpen);
  const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(defaultConfirmModalOpen);

  const activePrototype =
    prototypes.find((p) => p.id === selectedPrototypeId) ?? prototypes[0] ?? null;

  const [cloneNameDraft, setCloneNameDraft] = useState<string>('');
  const [importNameDraft, setImportNameDraft] = useState<string>('');
  const [importHtmlDraft, setImportHtmlDraft] = useState<string>('');
  const [deleteError, setDeleteError] = useState<string | null>(defaultDeleteError);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [measuredScale, setMeasuredScale] = useState<number>(() =>
    computeViewportFitScale(containerWidthOverride ?? 1200, viewport, zoomMode).scale,
  );

  useEffect(() => {
    setMeasuredScale(
      computeViewportFitScale(containerWidthOverride ?? 1200, viewport, zoomMode).scale,
    );
  }, [containerWidthOverride, viewport, zoomMode]);

  useEffect(() => {
    setPreviewRevisionId(null);
    setDeleteError(defaultDeleteError);
  }, [activePrototype?.id]);

  // Escape exits Focus Mode cleanly
  useEffect(() => {
    if (!focusMode || typeof window === 'undefined') return;
    return registerFocusModeEscapeListener(
      window as unknown as Parameters<typeof registerFocusModeEscapeListener>[0],
      {
        switcherOpen,
        confirmModalOpen,
        onCloseSwitcher: () => {
          setSwitcherOpen(false);
          setSwitcherSubPanel('NONE');
        },
        onCloseConfirmModal: () => setConfirmModalOpen(false),
        onExitFocusMode: () => setFocusMode(false),
      },
    );
  }, [confirmModalOpen, focusMode, setFocusMode, switcherOpen]);

  // Close switcher dropdown on outside click
  useEffect(() => {
    if (!switcherOpen || typeof document === 'undefined') return;
    const onPointerDown = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
        setSwitcherSubPanel('NONE');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [switcherOpen]);

  if (!activePrototype) return null;

  const currentRevision =
    activePrototype.revisions.find((r) => r.id === activePrototype.currentRevisionId) ??
    activePrototype.revisions[activePrototype.revisions.length - 1] ?? {
      id: activePrototype.currentRevisionId || `${activePrototype.id}-r1`,
      prototypeId: activePrototype.id,
      projectId: project.id,
      revisionNumber: 1,
      title: activePrototype.name,
      htmlContent: activePrototype.htmlContent,
      extractedScreenCount: activePrototype.extractedScreenCount,
      source: 'GENERATED' as const,
      createdAt: activePrototype.updatedAt,
    };

  const activeRevision =
    (previewRevisionId
      ? activePrototype.revisions.find((r) => r.id === previewRevisionId)
      : undefined) ?? currentRevision;

  const isPreviewingHistorical = activeRevision.id !== currentRevision.id;
  const displayedHtml = htmlOverride ?? activeRevision.htmlContent ?? activePrototype.htmlContent;

  const revStatus = resolveRevisionStatusSummary(
    activePrototype,
    activeRevision,
    confirmedRevision,
    locale,
  );
  const [confirmTargetRevision, setConfirmTargetRevision] = useState<PrototypeRevision | null>(
    null,
  );
  const [busyRevisionId, setBusyRevisionId] = useState<string | null>(null);
  const effectiveConfirmRevision = confirmTargetRevision ?? activeRevision;

  const handleOpenInNewTab = () => {
    openCleanPrototypeInNewTab(displayedHtml);
  };

  const handleImportHtmlContent = async (name: string, htmlContent: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const res = await runImportPrototypeHtml(project.id, name, htmlContent, locale);
      if (!res) return;
      onPrototypesUpdated({
        prototypes: res.prototypes,
        confirmedRevision: res.confirmedRevision,
        project: res.project,
        selectedPrototypeId: res.prototype.id,
      });
      onSelectPrototype(res.prototype.id);
      setSwitcherOpen(false);
      setSwitcherSubPanel('NONE');
      setImportNameDraft('');
      setImportHtmlDraft('');
      onNotify?.(
        t(
          `已导入原型「${res.prototype.name}」（单条初始修订，未修改 MU 模型）`,
          `Imported "${res.prototype.name}" (1 revision created; MU unchanged)`,
        ),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const content = await file.text();
    await handleImportHtmlContent(file.name.replace(/\.(html?|xhtml)$/i, ''), content);
  };

  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const res = await runClonePrototypeAsNew(
        activePrototype.id,
        activePrototype.name,
        cloneNameDraft,
        locale,
      );
      onPrototypesUpdated({
        prototypes: res.prototypes,
        confirmedRevision: res.confirmedRevision,
        selectedPrototypeId: res.prototype.id,
      });
      onSelectPrototype(res.prototype.id);
      setSwitcherOpen(false);
      setSwitcherSubPanel('NONE');
      setCloneNameDraft('');
      onNotify?.(
        t(
          `已另存为新原型「${res.prototype.name}」，已复制当前修订与设计简报并分叉共创会话`,
          `Saved as new prototype "${res.prototype.name}" with Design Brief and forked session`,
        ),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setDeleteError(null);
    try {
      const res = await runDeletePrototypeSafely(activePrototype.id, project.id, locale);
      if (!res.ok) {
        setDeleteError(res.errorMessage);
        return;
      }
      const nextSelected = res.prototypes[0]?.id ?? '';
      onPrototypesUpdated({
        prototypes: res.prototypes,
        confirmedRevision: res.confirmedRevision,
        ...(nextSelected ? { selectedPrototypeId: nextSelected } : {}),
      });
      if (nextSelected) {
        onSelectPrototype(nextSelected);
      }
      setSwitcherOpen(false);
      setSwitcherSubPanel('NONE');
      onNotify?.(
        t(`已删除原型「${activePrototype.name}」`, `Deleted "${activePrototype.name}"`),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const res = await apiRestorePrototypeRevision(activePrototype.id, revisionId);
      onPrototypesUpdated({
        prototypes: res.prototypes,
        confirmedRevision: res.confirmedRevision,
        selectedPrototypeId: res.prototype.id,
      });
      setPreviewRevisionId(null);
      onNotify?.(
        t(
          `已将历史修订恢复为最新修订 R${res.revision.revisionNumber}`,
          `Restored revision as new revision R${res.revision.revisionNumber}`,
        ),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleRenameRevision = async (revisionId: string, newTitle: string) => {
    setBusyRevisionId(revisionId);
    try {
      const res = await apiUpdatePrototypeRevisionMeta(activePrototype.id, revisionId, {
        title: newTitle,
      });
      onPrototypesUpdated({
        prototypes: res.prototypes,
        confirmedRevision: res.confirmedRevision,
        selectedPrototypeId: res.prototype.id,
      });
    } finally {
      setBusyRevisionId(null);
    }
  };

  const handleToggleStarRevision = async (revisionId: string, nextStarred: boolean) => {
    setBusyRevisionId(revisionId);
    try {
      const res = await apiUpdatePrototypeRevisionMeta(activePrototype.id, revisionId, {
        starred: nextStarred,
      });
      onPrototypesUpdated({
        prototypes: res.prototypes,
        confirmedRevision: res.confirmedRevision,
        selectedPrototypeId: res.prototype.id,
      });
    } finally {
      setBusyRevisionId(null);
    }
  };

  const handleConfirmRevisionById = async (revisionId: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const res = await apiConfirmPrototypeRevision(project.id, revisionId);
      const confirmedNum =
        res.confirmedRevision?.revision.revisionNumber ?? effectiveConfirmRevision.revisionNumber;
      onPrototypesUpdated({
        prototypes: res.prototypes,
        confirmedRevision: res.confirmedRevision,
        project: res.project,
        selectedPrototypeId: res.prototype.id,
      });
      setConfirmModalOpen(false);
      setConfirmTargetRevision(null);
      onNotify?.(
        t(
          `已确认修订 R${confirmedNum}，MU 模型已同步更新`,
          `Confirmed revision R${confirmedNum} and synced MU model`,
        ),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const focusRightOffset = computeFocusModeRightOffset(
    focusMode,
    agentPanelOpen,
    agentPanelOverlay,
    agentPanelWidth,
  );
  const zoomPercent = Math.round(measuredScale * 100);

  return (
    <section
      data-testid="prototype-canvas-stage"
      data-focus-mode={focusMode ? 'true' : 'false'}
      aria-label={t('界面原型画布工作区', 'Interactive Prototype Canvas Stage')}
      className={cn(
        'flex flex-col overflow-hidden rounded-card border border-line bg-surface',
        focusMode
          ? 'fixed top-0 bottom-0 left-0 z-[980] rounded-none border-0 bg-ground shadow-lg'
          : 'min-h-[calc(100vh-128px)]',
      )}
      style={focusMode ? { right: focusRightOffset, animation: 'none' } : undefined}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm"
        data-testid="prototype-import-file-input"
        className="hidden"
        onChange={(e) => void handleImportFileChange(e)}
      />

      {/* ─── Single Top Toolbar ─── */}
      <header
        data-testid="prototype-canvas-toolbar"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2 shrink-0"
      >
        {/* Left group: Prototype Switcher + Back to Brief + Revision History */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div ref={switcherRef} className="relative">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="prototype-switcher-trigger"
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              onClick={() => {
                const next = !switcherOpen;
                setSwitcherOpen(next);
                if (!next) {
                  setSwitcherSubPanel('NONE');
                  setDeleteError(null);
                }
              }}
            >
              <span className="max-w-[200px] truncate font-medium text-ink">
                {activePrototype.name}
              </span>
              {confirmedRevision?.prototypeId === activePrototype.id && (
                <span className="badge badge-ok text-[10.5px]">
                  {t('含已确认', 'Confirmed')}
                </span>
              )}
              <ChevronDown size={13} className="text-muted shrink-0" aria-hidden="true" />
            </Button>

            {switcherOpen && (
              <div
                role="menu"
                aria-label={t('切换与管理界面原型', 'Switch and manage prototypes')}
                data-testid="prototype-switcher-menu"
                className="absolute top-[calc(100%+6px)] left-0 z-50 flex w-[min(360px,92vw)] flex-col gap-1.5 rounded-card border border-line bg-surface p-2 shadow-lg"
              >
                <div className="px-2 py-1 text-[11px] font-medium text-muted">
                  {t(
                    `当前工程原型方向 (${prototypes.length})`,
                    `Project Prototypes (${prototypes.length})`,
                  )}
                </div>

                <div className="flex max-h-[200px] flex-col gap-0.5 overflow-y-auto">
                  {prototypes.map((item) => {
                    const isSelected = item.id === activePrototype.id;
                    const holdsConfirmed =
                      confirmedRevision?.prototypeId === item.id ||
                      Boolean(item.confirmedRevisionId);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        data-testid={`prototype-switcher-item-${item.id}`}
                        onClick={() => {
                          onSelectPrototype(item.id);
                          setSwitcherOpen(false);
                          setSwitcherSubPanel('NONE');
                          setDeleteError(null);
                        }}
                        className={cn(
                          'flex w-full cursor-pointer items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                          isSelected
                            ? 'bg-accent-tint/60 font-medium text-ink'
                            : 'text-ink-2 hover:bg-hover hover:text-ink',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{item.name}</span>
                          {holdsConfirmed && (
                            <span className="badge badge-ok text-[10px]">
                              {t('已确认', 'Confirmed')}
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-muted">
                          {t(`${item.revisions.length} 修订`, `${item.revisions.length} rev`)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="my-0.5 h-px bg-line" />

                {/* Switcher Actions */}
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="prototype-import-html-btn"
                    onClick={() => {
                      setDeleteError(null);
                      setSwitcherSubPanel((cur) =>
                        cur === 'IMPORT_HTML' ? 'NONE' : 'IMPORT_HTML',
                      );
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <Upload size={13} className="text-muted" aria-hidden="true" />
                    <span>{t('导入 HTML…', 'Import HTML…')}</span>
                  </button>

                  {switcherSubPanel === 'IMPORT_HTML' && (
                    <form
                      data-testid="prototype-import-panel"
                      className="flex flex-col gap-2 rounded-[6px] border border-line bg-surface-2 p-2.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleImportHtmlContent(importNameDraft, importHtmlDraft);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11.5px] font-medium text-ink">
                          {t('导入单条修订新原型', 'Import 1-Revision Prototype')}
                        </span>
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload size={11.5} aria-hidden="true" />
                          {t('选择 .html 文件', 'Choose .html')}
                        </Button>
                      </div>
                      <label htmlFor={importNameId} className="sr-only">
                        {t('新原型名称', 'New prototype name')}
                      </label>
                      <input
                        id={importNameId}
                        data-testid="prototype-import-name-input"
                        className="input text-[12px]"
                        placeholder={t('原型名称（选填）', 'Prototype name (optional)')}
                        value={importNameDraft}
                        onChange={(e) => setImportNameDraft(e.target.value)}
                      />
                      <label htmlFor={importHtmlId} className="sr-only">
                        {t('粘贴 HTML 源码', 'Paste HTML source')}
                      </label>
                      <textarea
                        id={importHtmlId}
                        rows={3}
                        data-testid="prototype-import-html-textarea"
                        className="textarea font-mono text-[11.5px]"
                        placeholder={t('或在此粘贴完整 HTML…', 'Or paste full HTML here…')}
                        value={importHtmlDraft}
                        onChange={(e) => setImportHtmlDraft(e.target.value)}
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setSwitcherSubPanel('NONE')}
                        >
                          {t('取消', 'Cancel')}
                        </Button>
                        <Button
                          type="submit"
                          variant="accent"
                          size="xs"
                          data-testid="prototype-import-submit-btn"
                          disabled={actionBusy || !importHtmlDraft.trim()}
                        >
                          {t('创建原型', 'Import')}
                        </Button>
                      </div>
                    </form>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    data-testid="prototype-clone-action-btn"
                    onClick={() => {
                      setDeleteError(null);
                      setCloneNameDraft(
                        t(`${activePrototype.name} (新方向)`, `${activePrototype.name} (Copy)`),
                      );
                      setSwitcherSubPanel((cur) => (cur === 'CLONE' ? 'NONE' : 'CLONE'));
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <Copy size={13} className="text-muted" aria-hidden="true" />
                    <span>{t('另存为新原型…', 'Save as New Prototype…')}</span>
                  </button>

                  {switcherSubPanel === 'CLONE' && (
                    <form
                      data-testid="prototype-clone-panel"
                      className="flex flex-col gap-2 rounded-[6px] border border-line bg-surface-2 p-2.5"
                      onSubmit={(e) => void handleCloneSubmit(e)}
                    >
                      <label htmlFor={cloneNameId} className="text-[11.5px] font-medium text-ink">
                        {t(
                          '复制当前修订、设计简报并分叉共创会话：',
                          'Copy current revision, Design Brief & fork session:',
                        )}
                      </label>
                      <input
                        id={cloneNameId}
                        data-testid="prototype-clone-name-input"
                        className="input text-[12px]"
                        value={cloneNameDraft}
                        onChange={(e) => setCloneNameDraft(e.target.value)}
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setSwitcherSubPanel('NONE')}
                        >
                          {t('取消', 'Cancel')}
                        </Button>
                        <Button
                          type="submit"
                          variant="accent"
                          size="xs"
                          data-testid="prototype-clone-confirm-btn"
                          disabled={actionBusy}
                        >
                          {t('另存为新原型', 'Save New Prototype')}
                        </Button>
                      </div>
                    </form>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    data-testid="prototype-dropdown-back-to-brief-btn"
                    onClick={() => {
                      setSwitcherOpen(false);
                      setSwitcherSubPanel('NONE');
                      onBackToBrief();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <ArrowLeft size={13} className="text-muted" aria-hidden="true" />
                    <span>{t('返回设计简报', 'Edit Design Brief')}</span>
                  </button>

                  {onSynthesizeOntology && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="prototype-synthesize-ontology-btn"
                      disabled={synthesizingOntology}
                      onClick={() => {
                        setSwitcherOpen(false);
                        setSwitcherSubPanel('NONE');
                        onSynthesizeOntology(activePrototype.id);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
                    >
                      <Sparkles size={13} className="text-accent" aria-hidden="true" />
                      <span>
                        {synthesizingOntology
                          ? t('正在后台合成 11 模型…', 'Synthesizing 11 Models…')
                          : t('推导 11 元模型业务本体', 'Synthesize 11-Model Ontology')}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    data-testid="prototype-delete-action-btn"
                    onClick={() => {
                      setDeleteError(null);
                      setSwitcherSubPanel((cur) => (cur === 'DELETE' ? 'NONE' : 'DELETE'));
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] text-red hover:bg-hover"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    <span>{t('删除此原型…', 'Delete Prototype…')}</span>
                  </button>

                  {switcherSubPanel === 'DELETE' && (
                    <div
                      data-testid="prototype-delete-confirm-box"
                      className="flex flex-col gap-2 rounded-[6px] border border-red/40 bg-surface-2 p-2.5"
                    >
                      <p className="m-0 text-[12px] text-ink">
                        {t(
                          `确定删除原型「${activePrototype.name}」及其全部修订记录吗？`,
                          `Delete "${activePrototype.name}" and all its revisions?`,
                        )}
                      </p>
                      {deleteError && (
                        <div
                          role="alert"
                          data-testid="prototype-delete-error-banner"
                          className="rounded-[5px] border border-red/40 bg-surface px-2.5 py-1.5 text-[11.5px] text-red"
                        >
                          {deleteError}
                        </div>
                      )}
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            setSwitcherSubPanel('NONE');
                            setDeleteError(null);
                          }}
                        >
                          {t('取消', 'Cancel')}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          data-testid="prototype-delete-confirm-btn"
                          className="border-red/40 text-red"
                          disabled={actionBusy}
                          onClick={() => void handleDeleteConfirm()}
                        >
                          {t('确认删除', 'Confirm Delete')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="prototype-back-to-brief-btn"
            onClick={onBackToBrief}
          >
            <ArrowLeft size={13} aria-hidden="true" />
            <span>{t('返回简报', 'Back to Brief')}</span>
          </Button>

          <Button
            type="button"
            variant="toggle"
            size="sm"
            data-testid="prototype-history-btn"
            aria-pressed={historyOpen}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <History size={13} aria-hidden="true" />
            <span className="font-mono text-[11.5px]">R{activeRevision.revisionNumber}</span>
            <span className="max-w-[140px] truncate">{activeRevision.title}</span>
            <span
              className={cn(
                'badge text-[10.5px]',
                revStatus.isConfirmed
                  ? 'badge-ok'
                  : revStatus.aheadCount > 0
                    ? 'badge-warn'
                    : '',
              )}
            >
              {revStatus.badgeText}
            </span>
          </Button>
        </div>

        {/* Center group: Viewport Switcher + Auto-Fit Zoom */}
        <div
          role="group"
          aria-label={t('预览设备尺寸与缩放', 'Preview viewport and zoom')}
          className="flex flex-wrap items-center gap-1"
        >
          <Button
            type="button"
            variant="toggle"
            size="xs"
            data-testid="prototype-viewport-desktop"
            aria-pressed={viewport === 'DESKTOP'}
            onClick={() => setViewport('DESKTOP')}
          >
            <Laptop size={12.5} aria-hidden="true" />
            <span>{t('桌面 1440', 'Desktop 1440')}</span>
          </Button>
          <Button
            type="button"
            variant="toggle"
            size="xs"
            data-testid="prototype-viewport-tablet"
            aria-pressed={viewport === 'TABLET'}
            onClick={() => setViewport('TABLET')}
          >
            <Tablet size={12.5} aria-hidden="true" />
            <span>{t('平板 768', 'Tablet 768')}</span>
          </Button>
          <Button
            type="button"
            variant="toggle"
            size="xs"
            data-testid="prototype-viewport-mobile"
            aria-pressed={viewport === 'MOBILE'}
            onClick={() => setViewport('MOBILE')}
          >
            <Smartphone size={12.5} aria-hidden="true" />
            <span>{t('手机 390', 'Mobile 390')}</span>
          </Button>
          <Button
            type="button"
            variant="toggle"
            size="xs"
            data-testid="prototype-zoom-fit-toggle"
            aria-pressed={zoomMode === 'FIT'}
            onClick={() => setZoomMode(zoomMode === 'FIT' ? 'ACTUAL' : 'FIT')}
            title={t(
              '切换自适应缩放与 100% 原始像素比例',
              'Toggle between Auto-Fit scaling and 100% actual size',
            )}
          >
            <span className="font-mono text-[11px]">
              {zoomMode === 'FIT'
                ? t(`自适应 ${zoomPercent}%`, `Fit ${zoomPercent}%`)
                : '100%'}
            </span>
          </Button>
        </div>

        {/* Right group: Box-Select + Focus Mode + Open in New Tab + Agent Toggle (in Focus Mode) + Confirm Revision */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="toggle"
            size="sm"
            data-testid="prototype-inspect-toggle-btn"
            aria-pressed={inspectMode}
            onClick={() => setInspectMode(!inspectMode)}
          >
            <Crosshair size={13} aria-hidden="true" />
            <span>{t('框选', 'Box-Select')}</span>
            {annotations && annotations.length > 0 && (
              <span className="badge badge-accent font-mono text-[10px]">
                {annotations.length}
              </span>
            )}
          </Button>

          <Button
            type="button"
            variant="toggle"
            size="sm"
            data-testid="prototype-focus-mode-btn"
            aria-pressed={focusMode}
            onClick={() => setFocusMode(!focusMode)}
            title={
              focusMode
                ? t('退出专注模式 (Esc)', 'Exit Focus Mode (Esc)')
                : t('进入应用内专注全屏模式', 'Enter in-app Focus Mode')
            }
          >
            {focusMode ? (
              <Minimize2 size={13} aria-hidden="true" />
            ) : (
              <Maximize2 size={13} aria-hidden="true" />
            )}
            <span>
              {focusMode ? t('退出专注 (Esc)', 'Exit Focus (Esc)') : t('专注模式', 'Focus Mode')}
            </span>
          </Button>

          {focusMode && (
            <Button
              type="button"
              variant="toggle"
              size="sm"
              data-testid="prototype-focus-agent-toggle-btn"
              aria-pressed={agentPanelVisible}
              onClick={toggleShellAgentPanel}
            >
              <PanelRightOpen size={13} aria-hidden="true" />
              <span>{t('智能体面板', 'Agent Panel')}</span>
            </Button>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="prototype-open-tab-btn"
            onClick={handleOpenInNewTab}
            title={t('在浏览器新标签页打开干净的原型 HTML', 'Open clean prototype HTML in new tab')}
          >
            <ExternalLink size={13} aria-hidden="true" />
            <span>{t('新标签页打开', 'Open in New Tab')}</span>
          </Button>

          <Button
            type="button"
            variant={revStatus.isConfirmed ? 'secondary' : 'accent'}
            size="sm"
            data-testid="prototype-confirm-revision-btn"
            disabled={revStatus.isConfirmed || actionBusy}
            onClick={() => {
              if (revStatus.isConfirmed) return;
              if (onRequestConfirmRevision) {
                onRequestConfirmRevision(activePrototype, activeRevision);
              } else {
                setConfirmTargetRevision(activeRevision);
                setConfirmModalOpen(true);
              }
            }}
          >
            {revStatus.isConfirmed ? (
              <CheckCircle2 size={13.5} className="text-green" aria-hidden="true" />
            ) : (
              <Check size={13.5} aria-hidden="true" />
            )}
            <span>
              {revStatus.isConfirmed
                ? t('已确认此修订', 'Confirmed')
                : t('确认此修订', 'Confirm This Revision')}
            </span>
          </Button>
        </div>
      </header>

      {/* Historical revision preview notice */}
      {isPreviewingHistorical && (
        <div
          data-testid="prototype-historical-preview-banner"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-1.5 text-[12px] text-ink-2 shrink-0"
        >
          <span>
            {t(
              `正在预览历史修订 R${activeRevision.revisionNumber}「${activeRevision.title}」（当前最新为 R${currentRevision.revisionNumber}）`,
              `Previewing historical revision R${activeRevision.revisionNumber} "${activeRevision.title}" (latest is R${currentRevision.revisionNumber})`,
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={actionBusy}
              onClick={() => void handleRestoreRevision(activeRevision.id)}
            >
              <RotateCcw size={11.5} aria-hidden="true" />
              {t('恢复为新修订', 'Restore as New Revision')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setPreviewRevisionId(null)}
            >
              {t('回到最新修订', 'Back to Latest')}
            </Button>
          </div>
        </div>
      )}

      {canvasBannerSlot}

      {/* ─── Main Canvas Body (Preview + Optional Revision History Drawer) ─── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PrototypeVisualPreviewStage
            htmlContent={displayedHtml}
            inspectMode={inspectMode}
            onInspectModeChange={setInspectMode}
            {...(annotations ? { annotations } : {})}
            {...(onAddAnnotation ? { onAddAnnotation } : {})}
            {...(onApplyImmediate ? { onApplyImmediate } : {})}
            {...(onSelectTarget ? { onSelectTarget } : {})}
            {...(onSelectionCropUpgrade ? { onSelectionCropUpgrade } : {})}
            {...(showInlineInspectorPopover !== undefined
              ? { showInlinePopover: showInlineInspectorPopover }
              : {})}
            highlightedSelector={effectiveHighlightedSelector}
            activeRunningAnchor={activeRunningAnchor}
            {...(flashedAnchors ? { flashedAnchors } : {})}
            flashKey={flashKey}
            onEscape={focusMode ? () => setFocusMode(false) : undefined}
            busy={busy}
            allowInspectWhileBusy
            viewport={viewport}
            zoomMode={zoomMode}
            {...(containerWidthOverride !== undefined ? { containerWidthOverride } : {})}
            onScaleChange={({ scale }) => setMeasuredScale(scale)}
            fillHeight
          />
        </div>

        {historyOpen &&
          (renderRevisionHistory ? (
            renderRevisionHistory({
              prototype: activePrototype,
              activeRevision,
              previewRevisionId,
              confirmedRevision,
              onPreviewRevision: setPreviewRevisionId,
              onRestoreRevision: handleRestoreRevision,
              onClose: () => setHistoryOpen(false),
            })
          ) : (
            <PrototypeRevisionHistoryDrawer
              open
              prototype={activePrototype}
              confirmedRevision={confirmedRevision}
              {...(project.suite.MU ? { currentMu: project.suite.MU } : {})}
              domain={project.domain}
              previewRevisionId={previewRevisionId}
              busyRevisionId={busyRevisionId}
              onClose={() => setHistoryOpen(false)}
              onSelectPreviewRevision={(revId) =>
                setPreviewRevisionId(revId === currentRevision.id ? null : revId)
              }
              onRestoreRevision={handleRestoreRevision}
              onRenameRevision={handleRenameRevision}
              onToggleStarRevision={handleToggleStarRevision}
              onRequestConfirmRevision={(rev) => {
                if (onRequestConfirmRevision) {
                  onRequestConfirmRevision(activePrototype, rev);
                } else {
                  setConfirmTargetRevision(rev);
                  setConfirmModalOpen(true);
                }
              }}
              className="w-[380px] shrink-0 border-y-0 border-r-0 rounded-none"
            />
          ))}
      </div>

      {/* ─── Confirm Revision Modal Slot or Built-in MU-Diff Confirmation Modal (#26) ─── */}
      {confirmModalOpen &&
        (renderConfirmModal ? (
          renderConfirmModal({
            project,
            prototype: activePrototype,
            revision: effectiveConfirmRevision,
            confirmedRevision,
            onConfirmed: (res) => {
              onPrototypesUpdated({
                prototypes: res.prototypes,
                confirmedRevision: res.confirmedRevision,
                project: res.project,
                selectedPrototypeId: res.prototype.id,
              });
              setConfirmModalOpen(false);
              setConfirmTargetRevision(null);
            },
            onClose: () => {
              setConfirmModalOpen(false);
              setConfirmTargetRevision(null);
            },
          })
        ) : (
          <ConfirmRevisionMuDiffModal
            open
            revision={effectiveConfirmRevision}
            prototypeName={activePrototype.name}
            suite={project.suite}
            confirmedRevision={confirmedRevision}
            domain={project.domain}
            busy={actionBusy}
            onConfirm={handleConfirmRevisionById}
            onClose={() => {
              setConfirmModalOpen(false);
              setConfirmTargetRevision(null);
            }}
          />
        ))}
    </section>
  );
}
