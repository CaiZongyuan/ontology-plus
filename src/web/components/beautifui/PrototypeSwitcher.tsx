import React, { useEffect } from 'react';
import { ArrowLeft, ArrowRight, FlaskConical } from 'lucide-react';

export interface PrototypeVariantOption {
  key: string;
  label: string;
}

export interface PrototypeSwitcherProps {
  variants: (string | PrototypeVariantOption)[];
  current: string;
  onChange: (nextKey: string) => void;
}

/**
 * PROTOTYPE SWITCHER (throwaway helper per .agents/skills/prototype/UI.md)
 * Fixed bottom-center bar for flipping between UI prototype variants via `?variant=`.
 * Automatically hidden in production builds.
 */
export function PrototypeSwitcher({ variants, current, onChange }: PrototypeSwitcherProps) {
  const normalized: PrototypeVariantOption[] = variants.map((v) =>
    typeof v === 'string' ? { key: v, label: v } : v,
  );

  const currentIndex = Math.max(
    0,
    normalized.findIndex((item) => item.key === current),
  );
  const activeItem = normalized[currentIndex] ?? normalized[0];

  const selectByOffset = (delta: number) => {
    if (normalized.length === 0) return;
    const nextIdx = (currentIndex + delta + normalized.length) % normalized.length;
    const next = normalized[nextIdx];
    if (next) {
      syncVariantSearchParam(next.key);
      onChange(next.key);
    }
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        selectByOffset(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        selectByOffset(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!import.meta.env.DEV || normalized.length === 0 || !activeItem) {
    return null;
  }

  return (
    <div
      data-testid="prototype-variant-switcher"
      role="region"
      aria-label="Prototype Variant Switcher"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-[#171715]/95 px-3 py-1.5 text-[12px] text-[#f5f3ec] shadow-xl backdrop-blur-md"
    >
      <span className="inline-flex items-center gap-1 rounded-full bg-[#4c50c4] px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-wide text-white">
        <FlaskConical size={11} />
        PROTOTYPE
      </span>

      <button
        type="button"
        onClick={() => selectByOffset(-1)}
        title="Previous variant (←)"
        aria-label="Previous variant"
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <ArrowLeft size={12.5} />
      </button>

      <div className="flex items-center gap-1 px-1">
        {normalized.map((v) => {
          const isActive = v.key === activeItem.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => {
                syncVariantSearchParam(v.key);
                onChange(v.key);
              }}
              className={`cursor-pointer rounded-full px-2.5 py-0.5 font-medium transition-colors ${
                isActive
                  ? 'bg-white text-[#171715] shadow-xs'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="font-mono font-semibold">{v.key}</span>
              {v.label !== v.key && <span className="ml-1 text-[11.5px]">{v.label}</span>}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => selectByOffset(1)}
        title="Next variant (→)"
        aria-label="Next variant"
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <ArrowRight size={12.5} />
      </button>
    </div>
  );
}

export function readVariantSearchParam(defaultVariant = 'A'): string {
  if (typeof window === 'undefined') return defaultVariant;
  const params = new URLSearchParams(window.location.search);
  return params.get('variant') || defaultVariant;
}

export function syncVariantSearchParam(nextVariant: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('variant', nextVariant);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
