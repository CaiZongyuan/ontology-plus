import React from 'react';
import { Check, ChevronRight, CircleDashed, Loader2, Minus, TriangleAlert } from 'lucide-react';
import {
  PROTOTYPE_BUILD_PHASES,
  type PrototypeBuildPhaseId,
  type PrototypeBuildPhaseStatus,
  type PrototypeBuildState,
} from '../../../../packages/ontology-core/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import type { ScreenBuildView } from './buildView.js';

type T = (zh: string, en: string) => string;

function phaseName(phase: PrototypeBuildPhaseId, t: T): string {
  switch (phase) {
    case 'plan':
      return t('施工计划', 'Build plan');
    case 'style':
      return t('风格样张', 'Style Tile');
    case 'screens':
      return t('逐屏施工', 'Screens');
    case 'review':
      return t('截图检查', 'Screenshot check');
    case 'tours':
      return t('演示路线', 'Demo tours');
  }
}

/** What each phase reports about itself, from the build's real state only. */
function phaseDetail(
  phase: PrototypeBuildPhaseId,
  status: PrototypeBuildPhaseStatus,
  build: PrototypeBuildState,
  screens: readonly ScreenBuildView[],
  t: T,
): string {
  const total = build.plan.length;
  const done = screens.filter((s) => s.status === 'done').length;
  const failed = screens.filter((s) => s.status === 'failed').length;
  const writing = screens.filter((s) => s.status === 'writing').length;
  if (phase === 'plan') {
    if (status === 'now') return t(`正在列 · ${total} 屏`, `Listing · ${total}`);
    if (status === 'failed') return t('没列完', 'Not finished');
    return t(`${total} 屏`, `${total} screens`);
  }
  if (phase === 'style' && (status === 'now' || status === 'done')) {
    if (status === 'now') return t('正在画', 'Drawing');
    const ready = [...build.log].reverse().find((e) => e.kind === 'style_ready');
    return ready?.locked ? t('用你确认的设计值', 'Your approved values') : t('助手提出的设计值', 'Proposed values');
  }
  if (phase === 'screens' && status !== 'not_started') {
    if (status === 'now') {
      return t(
        `${done}/${total} 屏画好${writing > 0 ? ` · ${writing} 屏在画` : ''}`,
        `${done}/${total} drawn${writing > 0 ? ` · ${writing} drawing` : ''}`,
      );
    }
    if (failed > 0) return t(`${failed} 屏没画完`, `${failed} not finished`);
    return t(`${done} 屏都画好了`, `All ${done} drawn`);
  }
  if (phase === 'review' && (status === 'now' || status === 'done')) {
    const checked = screens.filter((s) => s.reviewed === 'pass' || s.reviewed === 'fixed').length;
    const fixed = screens.filter((s) => s.reviewed === 'fixed').length;
    const checking = screens.filter((s) => s.status === 'reviewing').length;
    const fixing = screens.filter((s) => s.status === 'fixing').length;
    if (status === 'now') {
      const activeNote =
        fixing > 0
          ? t(` · ${fixing} 屏在改`, ` · ${fixing} fixing`)
          : checking > 0
            ? t(` · ${checking} 屏在查`, ` · ${checking} checking`)
            : '';
      return t(`${checked}/${total} 屏已查${activeNote}`, `${checked}/${total} checked${activeNote}`);
    }
    if (fixed > 0) {
      return t(`${checked} 屏已查 · 修正 ${fixed} 屏`, `${checked} checked · ${fixed} fixed`);
    }
    return checked > 0 ? t(`${checked} 屏都通过`, `All ${checked} passed`) : t('完成', 'Done');
  }
  if (status === 'skipped') {
    return phase === 'review' ? t('未做视觉检查', 'Not visually checked') : t('本次未做', 'Not done this time');
  }
  if (status === 'now') return t('进行中', 'In progress');
  if (status === 'done') return t('完成', 'Done');
  if (status === 'failed') return t('没完成', 'Not finished');
  return t('未开始', 'Not started');
}

function PhaseIcon({ status }: { status: PrototypeBuildPhaseStatus }) {
  if (status === 'now') return <Loader2 size={12} className="animate-spin text-primary" aria-hidden="true" />;
  if (status === 'done') return <Check size={12} className="text-success" aria-hidden="true" />;
  if (status === 'failed') return <TriangleAlert size={12} className="text-destructive" aria-hidden="true" />;
  if (status === 'skipped') return <Minus size={12} className="text-muted-foreground" aria-hidden="true" />;
  return <CircleDashed size={12} className="text-muted-foreground" aria-hidden="true" />;
}

/**
 * The phase bar of the Build Plan (#90, #88 layout D): 施工计划 → 风格样张 → 逐屏施工 → 截图检查 →
 * 演示路线. Each phase shows its own real state; several can be "now" at once. It wraps instead
 * of scrolling, so nothing anchored to it can be clipped.
 */
export function BuildPhaseBar({
  build,
  screens,
}: {
  build: PrototypeBuildState;
  screens: readonly ScreenBuildView[];
}) {
  const { t } = usePreferences();
  return (
    <ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-1 p-0" data-testid="prototype-build-phases">
      {PROTOTYPE_BUILD_PHASES.map((phase, idx) => {
        const status = build.phases[phase].status;
        return (
          <li key={phase} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight size={12} className="text-muted-foreground" aria-hidden="true" />}
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
                status === 'now' && 'border-primary/40 bg-primary-soft text-foreground',
                status === 'done' && 'border-border bg-background text-foreground',
                status === 'failed' && 'border-destructive/40 bg-destructive-soft text-foreground',
                (status === 'not_started' || status === 'skipped') && 'border-dashed border-border text-muted-foreground',
              )}
              data-testid={`prototype-phase-${phase}`}
              data-phase-status={status}
            >
              <PhaseIcon status={status} />
              <span className="font-medium">{phaseName(phase, t)}</span>
              <span className="text-muted-foreground">{phaseDetail(phase, status, build, screens, t)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
