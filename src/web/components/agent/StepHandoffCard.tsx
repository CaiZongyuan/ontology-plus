import React from 'react';
import { ArrowRight, ArrowRightLeft, Check } from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  PROJECT_STEP_NAMES,
  sanitizeBusinessText,
  type ProjectStepId,
} from '../../../packages/business-vocabulary/index.js';
import type { StepHandoffProposal } from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';

export interface StepHandoffCardProps {
  handoff: StepHandoffProposal;
  disabled?: boolean;
  busyAction?: 'accept' | 'decline' | null;
  onAccept?: (handoffId: string) => void | Promise<void>;
  onDecline?: (handoffId: string) => void | Promise<void>;
  onOpenTargetStep?: (targetStep: ProjectStepId, targetSessionId?: string) => void;
  className?: string;
}

export function StepHandoffCard({
  handoff,
  disabled = false,
  busyAction = null,
  onAccept,
  onDecline,
  onOpenTargetStep,
  className,
}: StepHandoffCardProps) {
  const { locale, t } = usePreferences();
  const stepName = PROJECT_STEP_NAMES[handoff.targetStep];
  const cleanRequest = sanitizeBusinessText(handoff.request, locale) || handoff.request;
  const cleanReason = handoff.reason ? sanitizeBusinessText(handoff.reason, locale) : '';

  if (handoff.status === 'ACCEPTED' || handoff.status === 'DECLINED') {
    const isAccepted = handoff.status === 'ACCEPTED';
    return (
      <div
        data-testid="step-handoff-card"
        data-handoff-status={handoff.status}
        data-target-step={handoff.targetStep}
        className={cn('w-full min-w-0', className)}
      >
        <div
          data-testid="step-handoff-resolved"
          className="primitive-card-bar flex w-full min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-card border border-border bg-muted/45 px-3 py-1.5 text-[12.5px] animate-[fade-in_200ms_var(--ease-out-strong)_both]"
        >
          {isAccepted ? (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
              <Check size={10} strokeWidth={2.75} aria-hidden="true" />
            </span>
          ) : (
            <ArrowRightLeft size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {isAccepted
              ? t(
                  `已转到「${stepName.zh}」步骤继续：${cleanRequest}`,
                  `Handed off to ${stepName.en}: ${cleanRequest}`,
                )
              : t(
                  '已选择留在这里，未转交该请求。',
                  'Stayed in this step; request was not handed off.',
                )}
          </span>
          {isAccepted && onOpenTargetStep && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="step-handoff-open-target-btn"
              onClick={() => onOpenTargetStep(handoff.targetStep, handoff.targetSessionId)}
            >
              {t(`查看${stepName.zh}`, `Open ${stepName.en}`)}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const isBusy = disabled || Boolean(busyAction);

  return (
    <div
      data-testid="step-handoff-card"
      data-handoff-status="PENDING"
      data-target-step={handoff.targetStep}
      className={cn(
        'w-full overflow-hidden rounded-card border border-border bg-card shadow-card text-[13px] animate-[fade-up_220ms_var(--ease-out-strong)_both]',
        className,
      )}
    >
      <div className="primitive-card-bar flex items-center justify-between border-b border-border bg-primary-soft/45">
        <div className="flex items-center gap-1.5">
          <ArrowRightLeft size={14} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="text-[12.5px] font-semibold text-primary">
            {t(`转到「${stepName.zh}」步骤？`, `Hand off to ${stepName.en}?`)}
          </span>
        </div>
      </div>

      <div className="primitive-card-pad space-y-2">
        <blockquote
          data-testid="step-handoff-request"
          className="m-0 rounded-md border border-border bg-muted/55 px-3 py-2 text-[13px] font-medium leading-relaxed text-foreground break-words"
        >
          {cleanRequest}
        </blockquote>

        <p className="m-0 text-[12.5px] leading-relaxed text-muted-foreground">
          {t(
            `${cleanReason ? `${cleanReason}。` : ''}转过去后，这句话会原样发到「${stepName.zh}」步骤的对话里，由那里的${BUSINESS_VOCABULARY.AI_ASSISTANT.zh}处理；留在这里则不会改动任何内容。`,
            `${cleanReason ? `${cleanReason}. ` : ''}If you continue, this request will be delivered verbatim to the conversation in ${stepName.en} for the ${BUSINESS_VOCABULARY.AI_ASSISTANT.en} there; staying here makes no changes.`,
          )}
        </p>
      </div>

      <div className="primitive-card-footer flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40">
        <Button
          variant="secondary"
          size="sm"
          disabled={isBusy || !onDecline}
          data-testid="step-handoff-decline-btn"
          onClick={() => void onDecline?.(handoff.id)}
        >
          {t('留在这里', 'Stay here')}
        </Button>
        <Button
          variant="accent"
          size="sm"
          disabled={isBusy || !onAccept}
          data-testid="step-handoff-accept-btn"
          onClick={() => void onAccept?.(handoff.id)}
        >
          {t('转到该步骤继续', `Continue in ${stepName.en}`)}
          <ArrowRight size={12} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
