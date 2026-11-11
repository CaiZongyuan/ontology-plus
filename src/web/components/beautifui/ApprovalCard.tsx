import React, { useState } from 'react';
import { Check, CornerDownLeft, Sparkles } from 'lucide-react';
import type { AgentAskUserPrompt } from '../../../packages/workspace-store/index.js';
import { cn } from '../../lib/utils.js';
import { Button } from './Button.js';
import { GlideMenu } from './GlideMenu.js';

export interface ApprovalCardProps {
  prompt: AgentAskUserPrompt;
  disabled?: boolean;
  onSubmit?: (selectedOptions: string[], customNote?: string) => void;
  className?: string;
}

export function ApprovalCard({
  prompt,
  disabled = false,
  onSubmit,
  className,
}: ApprovalCardProps) {
  const [selected, setSelected] = useState<string[]>(
    prompt.selectedAnswers && prompt.selectedAnswers.length > 0
      ? prompt.selectedAnswers
      : prompt.options[0]
        ? [prompt.options[0]]
        : [],
  );
  const [customText, setCustomText] = useState('');

  if (prompt.answered) {
    return (
      <div
        className={cn(
          'primitive-card-bar inline-flex flex-wrap items-center gap-2 rounded-card bg-surface shadow-card text-[12.5px] animate-[fade-in_200ms_var(--ease-out-strong)_both]',
          className,
        )}
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-tint text-green">
          <Check size={10} strokeWidth={2.75} />
        </span>
        <span className="font-medium text-ink">
          {prompt.header || '已确认业务决策'}
        </span>
        <span className="text-ink-3">
          {(prompt.selectedAnswers ?? []).join(' · ') || 'Submitted'}
        </span>
      </div>
    );
  }

  const toggleOption = (label: string) => {
    if (disabled) return;
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
    const answers = [...selected];
    if (customText.trim()) {
      answers.push(customText.trim());
    }
    if (answers.length === 0) return;
    onSubmit(answers, customText.trim() || undefined);
  };

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-card bg-surface shadow-card text-[13px] animate-[fade-up_220ms_var(--ease-out-strong)_both]',
        className,
      )}
      data-testid="agent-hitl-card"
    >
      <div className="primitive-card-bar flex items-center justify-between border-b border-line bg-accent-tint/45">
        <div className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-accent" />
          <span className="text-[11.5px] font-semibold text-accent">
            {prompt.header || '需要补充业务决策 (Scoped HITL)'}
          </span>
        </div>
        <span className="font-mono text-[11.5px] text-ink-3">
          {prompt.multiSelect ? '可多选' : '单选'}
        </span>
      </div>

      <div className="primitive-card-pad">
        <div className="mb-2.5 text-[13px] font-medium leading-snug text-ink">
          {prompt.question}
        </div>

        {prompt.options.length > 0 && (
          <GlideMenu className="space-y-0.5">
            {prompt.options.map((optLabel) => {
              const isSelected = selected.includes(optLabel);
              return (
                <button
                  key={optLabel}
                  type="button"
                  data-glide-item
                  disabled={disabled}
                  onClick={() => toggleOption(optLabel)}
                  className="relative z-10 flex w-full cursor-pointer items-start gap-2.5 rounded-control px-2.5 py-2 text-left disabled:opacity-50"
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition-colors duration-150',
                      prompt.multiSelect ? 'rounded-[4px]' : 'rounded-full',
                      isSelected ? 'border-ink bg-ink' : 'border-line-strong bg-surface',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full bg-surface transition-transform duration-180 ease-out-strong',
                        isSelected ? 'scale-100' : 'scale-0',
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-ink">
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
              value={customText}
              disabled={disabled}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              placeholder="或输入补充说明 / 自定义参数..."
              className="w-full rounded-control border border-line bg-field px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="primitive-card-footer flex items-center justify-end gap-2 border-t border-line bg-inset/40">
        <Button
          variant="accent"
          size="xs"
          disabled={disabled || (selected.length === 0 && !customText.trim())}
          onClick={handleConfirm}
          data-testid="agent-hitl-submit-btn"
        >
          确认并继续推理
          <CornerDownLeft size={11} strokeWidth={2} className="opacity-80" />
        </Button>
      </div>
    </div>
  );
}
