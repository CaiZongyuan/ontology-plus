import React, { useState } from 'react';
import { Check, CornerDownLeft, Sparkles } from 'lucide-react';
import type { AgentAskUserPrompt } from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from './Button.js';
import { GlideMenu } from './GlideMenu.js';

export interface ApprovalCardProps {
  prompt: AgentAskUserPrompt;
  disabled?: boolean;
  onSubmit?: (selectedOptions: string[], customNote?: string) => void;
  className?: string;
}

function formatQuestionHeader(
  rawHeader: string | undefined,
  t: (zh: string, en: string) => string,
): string {
  if (!rawHeader?.trim()) {
    return t('需要你的业务选择', 'Your choice needed');
  }
  const cleaned = rawHeader
    .replace(/\(\s*Scoped\s+HITL\s*\)/gi, '')
    .replace(/^B\s*类/i, '')
    .replace(/^Class-B\s+/i, '')
    .trim();
  return cleaned || t('需要你的业务选择', 'Your choice needed');
}

export function ApprovalCard({
  prompt,
  disabled = false,
  onSubmit,
  className,
}: ApprovalCardProps) {
  const { t } = usePreferences();
  const [selected, setSelected] = useState<string[]>(
    prompt.selectedAnswers && prompt.selectedAnswers.length > 0
      ? prompt.selectedAnswers
      : prompt.options[0]
        ? [prompt.options[0]]
        : [],
  );
  const [explicitOptionPicked, setExplicitOptionPicked] = useState(false);
  const [customText, setCustomText] = useState('');

  if (prompt.answered) {
    const answerSummary =
      (prompt.selectedAnswers ?? []).join(' · ').trim() || t('已回答', 'Answered');
    return (
      <div
        data-testid="agent-hitl-answered-summary"
        className={cn(
          'primitive-card-bar flex w-full min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-card border border-border bg-muted/45 px-3 py-1.5 text-[12.5px] animate-[fade-in_200ms_var(--ease-out-strong)_both]',
          className,
        )}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
          <Check size={10} strokeWidth={2.75} />
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{prompt.question}</span>
        <span className="shrink-0 text-faint-foreground" aria-hidden="true">
          ·
        </span>
        <span className="min-w-0 max-w-[52%] shrink-0 truncate font-medium text-foreground">
          {answerSummary}
        </span>
      </div>
    );
  }

  const toggleOption = (label: string) => {
    if (disabled) return;
    setExplicitOptionPicked(true);
    if (prompt.multiSelect) {
      setSelected((prev) =>
        prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label],
      );
    } else {
      setSelected([label]);
    }
  };

  const handleConfirm = () => {
    if (disabled || !onSubmit) return;
    const trimmedCustom = customText.trim();
    let answers: string[];
    if (!prompt.multiSelect && trimmedCustom && !explicitOptionPicked) {
      answers = [trimmedCustom];
    } else {
      answers = [...selected];
      if (trimmedCustom && !answers.includes(trimmedCustom)) {
        answers.push(trimmedCustom);
      }
    }
    if (answers.length === 0) return;
    onSubmit(answers, trimmedCustom || undefined);
  };

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-card bg-card shadow-card text-[13px] animate-[fade-up_220ms_var(--ease-out-strong)_both]',
        className,
      )}
      data-testid="agent-hitl-card"
    >
      <div className="primitive-card-bar flex items-center justify-between border-b border-border bg-primary-soft/45">
        <div className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-primary" />
          <span className="text-xs font-semibold text-primary">
            {formatQuestionHeader(prompt.header, t)}
          </span>
        </div>
        <span className="text-xs text-faint-foreground">
          {prompt.multiSelect ? t('可多选', 'Multi-select') : t('点选一项', 'Pick one')}
        </span>
      </div>

      <div className="primitive-card-pad">
        <div className="mb-2.5 text-[13px] font-medium leading-snug text-foreground">
          {prompt.question}
        </div>

        {prompt.options.length > 0 && (
          <GlideMenu className="space-y-0.5">
            {prompt.options.map((optLabel, idx) => {
              const isSelected = selected.includes(optLabel);
              return (
                <button
                  key={optLabel}
                  type="button"
                  data-glide-item
                  data-testid={`agent-hitl-option-${idx}`}
                  aria-pressed={isSelected}
                  disabled={disabled}
                  onClick={() => toggleOption(optLabel)}
                  className="relative z-10 flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left disabled:opacity-50"
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition-colors duration-150',
                      prompt.multiSelect ? 'rounded-xs' : 'rounded-full',
                      isSelected ? 'border-foreground bg-foreground' : 'border-border-strong bg-card',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full bg-card transition-transform duration-180 ease-out-strong',
                        isSelected ? 'scale-100' : 'scale-0',
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-foreground">
                      {optLabel}
                    </span>
                  </span>
                </button>
              );
            })}
          </GlideMenu>
        )}

        {(prompt.allowFreeform ?? true) && (
          <div className="mt-2.5">
            <input
              type="text"
              data-testid="agent-hitl-freeform-input"
              value={customText}
              disabled={disabled}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              placeholder={t(
                '都不合适？在这里用你自己的话回答…',
                'Or enter your own answer here…',
              )}
              className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-[12.5px] text-foreground placeholder:text-faint-foreground focus:border-primary focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="primitive-card-footer flex items-center justify-end gap-2 border-t border-border bg-muted/40">
        <Button
          variant="accent"
          size="xs"
          disabled={disabled || (selected.length === 0 && !customText.trim())}
          onClick={handleConfirm}
          data-testid="agent-hitl-submit-btn"
        >
          {t('确定并继续', 'Confirm & Continue')}
          <CornerDownLeft size={11} strokeWidth={2} className="opacity-80" />
        </Button>
      </div>
    </div>
  );
}
