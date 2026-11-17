import React from 'react';
import { Check } from 'lucide-react';
import type { ProjectStepId } from '../../../packages/business-vocabulary/index.js';
import { usePreferences } from '../../i18n.js';
import type { ProjectStepStatusView } from '../../navigation/index.js';

export interface StepIndicatorBarProps {
  readonly steps: readonly ProjectStepStatusView[];
  readonly activeStep: ProjectStepId;
  readonly onSelectStep: (step: ProjectStepId) => void;
}

export function StepIndicatorBar({
  steps,
  activeStep,
  onSelectStep,
}: StepIndicatorBarProps) {
  const { t } = usePreferences();

  return (
    <ol
      className="wb-step-bar"
      data-testid="project-step-bar"
      aria-label={t('项目步骤', 'Project steps')}
    >
      {steps.map((step, idx) => {
        const isCurrent = step.id === activeStep;
        const isConfirmed = step.state === 'CONFIRMED';
        const isBlocked = Boolean(step.blocked);

        return (
          <li key={step.id} className="wb-step-item">
            {idx > 0 && <span className="wb-step-line" aria-hidden="true" />}
            <button
              type="button"
              className="wb-step-btn"
              data-testid={`step-tab-${step.id}`}
              data-step-state={step.state}
              data-blocked={isBlocked ? 'true' : 'false'}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => onSelectStep(step.id)}
            >
              <span
                className="wb-step-marker"
                data-state={step.state}
                data-blocked={isBlocked ? 'true' : 'false'}
                aria-hidden="true"
              >
                {isConfirmed ? <Check size={12} strokeWidth={2.5} /> : idx + 1}
              </span>
              <span className="wb-step-text">
                <span className="wb-step-name">{t(step.name.zh, step.name.en)}</span>
                {step.blocked ? (
                  <span
                    className="wb-step-status is-blocked text-[12px] text-muted-foreground"
                    data-testid={`step-status-${step.id}`}
                    data-blocked="true"
                  >
                    {t(step.blocked.reason.zh, step.blocked.reason.en)}
                  </span>
                ) : (
                  <span
                    className="wb-step-status text-[12px]"
                    data-testid={`step-status-${step.id}`}
                    data-state={step.state}
                  >
                    {t(step.stateLabel.zh, step.stateLabel.en)}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
