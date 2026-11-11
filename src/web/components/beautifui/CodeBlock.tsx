import React, { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface CodeLine {
  text: string;
  kind?: 'context' | 'add' | 'del';
}

const TOKEN_RE =
  /(\/\/[^\n]*|--[^\n]*|#[^\n]*)|('[^']*'|"[^"]*"|`[^`]*`)|\b(import|export|from|const|let|var|return|async|await|if|else|new|function|type|interface|SELECT|FROM|WHERE|JOIN|GROUP|ORDER|BY|LIMIT|AND|OR|INSERT|UPDATE|CREATE|TABLE|true|false|null|undefined)\b|(\b\d+(?:\.\d+)?\b)/g;

function highlightLine(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const [full, comment, str, kw, num] = m;
    const color = comment
      ? 'var(--ink-3)'
      : str
        ? 'var(--green)'
        : kw
          ? 'var(--accent)'
          : num
            ? 'var(--orange)'
            : undefined;
    out.push(
      <span key={k++} style={color ? { color } : undefined}>
        {full}
      </span>,
    );
    last = idx + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : text || ' ';
}

export interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  maxHeight?: number;
  className?: string;
}

export function CodeBlock({
  code,
  language,
  filename,
  maxHeight = 360,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const lines = useMemo<CodeLine[]>(() => {
    const rawLines = code.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    const isDiff = language === 'diff' || language === 'patch';
    return rawLines.map((line) => {
      if (isDiff && line.startsWith('+') && !line.startsWith('+++')) {
        return { text: line.slice(1), kind: 'add' };
      }
      if (isDiff && line.startsWith('-') && !line.startsWith('---')) {
        return { text: line.slice(1), kind: 'del' };
      }
      return { text: line, kind: 'context' };
    });
  }, [code, language]);

  const adds = lines.filter((l) => l.kind === 'add').length;
  const dels = lines.filter((l) => l.kind === 'del').length;

  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  let lineNo = 0;

  return (
    <div className={cn('my-2 w-full overflow-hidden rounded-card bg-surface shadow-card', className)}>
      <div className="primitive-card-bar flex items-center gap-2 border-b border-line bg-inset/45">
        <span className="truncate font-mono text-[11.5px] text-ink-2">
          {filename || language || 'text'}
        </span>
        {(adds > 0 || dels > 0) && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
            {adds > 0 && <span className="text-green">+{adds}</span>}
            {dels > 0 && <span className="text-red">-{dels}</span>}
          </span>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="primitive-icon-button ml-auto cursor-pointer text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink"
        >
          <span className="relative flex h-3.5 w-3.5 items-center justify-center">
            <Copy
              size={13}
              strokeWidth={1.75}
              className={cn(
                'absolute transition-[opacity,transform] duration-180 ease-out-strong',
                copied ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
              )}
            />
            <Check
              size={13}
              strokeWidth={2.25}
              className={cn(
                'absolute text-green transition-[opacity,transform] duration-180 ease-out-strong',
                copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
              )}
            />
          </span>
        </button>
      </div>

      <div
        className="overflow-auto py-2 font-mono text-[12px] leading-[1.6]"
        style={{ maxHeight }}
      >
        {lines.map((line, i) => {
          const isAdd = line.kind === 'add';
          const isDel = line.kind === 'del';
          const num = isDel ? ' ' : ++lineNo;
          return (
            <div
              key={i}
              className={cn(
                'flex px-3 whitespace-pre',
                isAdd && 'bg-green-tint',
                isDel && 'bg-red-tint',
              )}
            >
              <span className="w-7 shrink-0 select-none pr-2 text-right text-ink-3/70 tabular-nums">
                {num}
              </span>
              {(adds > 0 || dels > 0) && (
                <span
                  className={cn(
                    'w-4 shrink-0 select-none',
                    isAdd && 'text-green',
                    isDel && 'text-red',
                    !isAdd && !isDel && 'text-ink-3',
                  )}
                >
                  {isAdd ? '+' : isDel ? '-' : ' '}
                </span>
              )}
              <span className={cn('text-ink', isDel && 'text-ink-2 line-through opacity-75')}>
                {highlightLine(line.text)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

