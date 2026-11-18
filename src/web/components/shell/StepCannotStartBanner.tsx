import React from 'react';
import { ArrowRight, CircleDashed } from 'lucide-react';
import type { ProjectStepId } from '../../../packages/business-vocabulary/index.js';
import { usePreferences } from '../../i18n.js';
import type { ProjectStepStatusView } from '../../navigation/index.js';
import { Button } from '../beautifui/index.js';

export interface StepCannotStartBannerProps {
  readonly step: ProjectStepStatusView;
  readonly onNavigateStep: (step: ProjectStepId) => void;
  readonly variant?: 'banner' | 'card';
}

/**
 * Non-blocking guidance shown on a Project Step canvas when its upstream step
 * has not been completed yet and the step has no existing content (Spec #37 §6).
 */
export function StepCannotStartBanner({
  step,
  onNavigateStep,
  variant = 'banner',
}: StepCannotStartBannerProps) {
  const { t } = usePreferences();
  const blocked = step.blocked;
  if (!blocked) return null;

  const heading = t(
    `${step.name.zh}还不能开始`,
    `${step.name.en} cannot start yet`,
  );
  const detail = t(blocked.detail.zh, blocked.detail.en);
  const actionText = t(blocked.actionLabel.zh, blocked.actionLabel.en);

  if (variant === 'card') {
    return (
      <section
        className="wb-cannot-start-card"
        data-testid="step-cannot-start-banner"
        aria-label={heading}
      >
        <span className="wb-cannot-start-icon" aria-hidden="true">
          <CircleDashed size={24} />
        </span>
        <h2 className="wb-cannot-start-title">{heading}</h2>
        <p className="wb-cannot-start-detail">{detail}</p>
        <Button
          type="button"
          variant="accent"
          size="md"
          data-testid="step-cannot-start-action"
          onClick={() => onNavigateStep(blocked.upstreamStep)}
        >
          <span>{actionText}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </section>
    );
  }

  return (
    <section
      className="wb-cannot-start-banner"
      data-testid="step-cannot-start-banner"
      aria-label={heading}
    >
      <div className="wb-cannot-start-main">
        <span className="wb-cannot-start-icon" aria-hidden="true">
          <CircleDashed size={16} />
        </span>
        <p className="wb-cannot-start-copy">
          <strong>{heading}</strong>
          <span> · </span>
          <span>{detail}</span>
        </p>
      </div>
      <Button
        type="button"
        variant="accent"
        size="sm"
        data-testid="step-cannot-start-action"
        onClick={() => onNavigateStep(blocked.upstreamStep)}
      >
        <span>{actionText}</span>
        <ArrowRight size={13} aria-hidden="true" />
      </Button>
    </section>
  );
}
