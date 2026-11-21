import React, { useEffect, useId, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { AgentSession, LlmProviderConfig } from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';

export type SessionExecutionSettings = Pick<AgentSession, 'providerId' | 'modelOverride' | 'multiAgentConcurrency'>;

export function SessionExecutionPicker({ session, providers, saving, onChange }: {
  session?: SessionExecutionSettings;
  providers: LlmProviderConfig[];
  saving: boolean;
  onChange: (patch: SessionExecutionSettings) => void;
}) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const enabled = providers.filter((provider) => provider.enabled);
  const provider = session?.providerId ? enabled.find((item) => item.id === session.providerId) : enabled[0];
  const count = session?.multiAgentConcurrency ?? 3;
  const model = session?.modelOverride || provider?.defaultModel;
  const label = t('对话设置', 'Conversation settings');
  const unavailable = Boolean((session?.providerId || session?.modelOverride) && (!provider ||
    (model && ![provider.defaultModel, ...provider.availableModels].includes(model))));
  const value = unavailable ? 'unavailable' : session?.providerId || session?.modelOverride ? JSON.stringify([provider?.id, model]) : '';
  return <div ref={root} className="relative" onKeyDown={(event) => {
    if (open && event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
  }} onBlur={(event) => {
    if (event.relatedTarget && !root.current?.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" ref={trigger} className="composer-attach-btn" data-testid="session-execution-settings"
      aria-label={label} title={`${label} · ${model || t('未配置模型', 'No model configured')} · ×${count}`}
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <Settings2 size={14} aria-hidden="true" />
    </button>
    {open && <div id={panelId} role="group" aria-label={label} aria-busy={saving}
      className="absolute bottom-full right-0 z-20 mb-2 grid w-60 gap-2 rounded-md border border-border bg-card p-3 text-xs text-foreground shadow-md">
      <label className="grid gap-1">{t('模型', 'Model')}
        <select className="w-full rounded border border-border bg-background p-1" value={value}
          disabled={saving || !enabled.length} onChange={(event) => {
            const [providerId, modelOverride] = event.target.value ? JSON.parse(event.target.value) as [string, string] : ['', ''];
            onChange({ providerId, modelOverride });
          }}>
          <option value="">{!enabled.length ? t('没有已启用的模型服务', 'No enabled model providers') :
            `${t('跟随默认设置', 'Use default')} · ${enabled[0].defaultModel}`}</option>
          {unavailable && <option value="unavailable" disabled>{t('所选模型已不可用', 'Selected model unavailable')}</option>}
          {enabled.map((item) => <optgroup key={item.id} label={item.name}>
            {Array.from(new Set([item.defaultModel, ...item.availableModels])).filter(Boolean).map((name) =>
              <option key={name} value={JSON.stringify([item.id, name])}>{name}</option>)}
          </optgroup>)}
        </select>
      </label>
      <label className="grid gap-1">{t('最多并行助手数', 'Maximum parallel assistants')}
        <select className="rounded border border-border bg-background p-1" value={count} disabled={saving}
          onChange={(event) => onChange({ multiAgentConcurrency: Number(event.target.value) })}>
          {[1, 2, 3, 4, 5, 6].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
        </select>
      </label>
      <span className="text-muted-foreground">{t('从本对话的下一次回复生效。', 'Applies to the next reply in this conversation.')}</span>
    </div>}
  </div>;
}
