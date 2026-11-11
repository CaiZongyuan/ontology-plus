import React, { useEffect, useId, useState } from 'react';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { cn } from '../../lib/utils.js';

let initializedTheme: string | null = null;

function ensureMermaidConfig(isDark: boolean) {
  const targetTheme = isDark ? 'dark' : 'neutral';
  if (initializedTheme === targetTheme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: targetTheme,
    fontFamily: 'IBM Plex Sans, Noto Sans SC, sans-serif',
  });
  initializedTheme = targetTheme;
}

export interface MermaidDiagramProps {
  chart: string;
  className?: string;
}

/**
 * Renders Mermaid diagrams in the browser and sanitizes SVG output with DOMPurify
 * per `modern-web-guidance` (`sanitize-untrusted-html`).
 */
export function MermaidDiagram({ chart, className }: MermaidDiagramProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = chart.trim();
    if (!trimmed) {
      setSvgHtml('');
      setErrorMsg(null);
      return;
    }

    let cancelled = false;
    const renderDiagram = async () => {
      try {
        const isDark =
          typeof document !== 'undefined' &&
          document.documentElement.getAttribute('data-theme') === 'dark';
        ensureMermaidConfig(isDark);
        const renderId = `mermaid-${rawId}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(renderId, trimmed);
        if (cancelled) return;
        const cleanSvg = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ['foreignObject'],
        });
        setSvgHtml(cleanSvg);
        setErrorMsg(null);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : 'Invalid Mermaid syntax');
      }
    };

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [chart, rawId]);

  if (errorMsg) {
    return (
      <div className={cn('my-2 rounded-card border border-line bg-inset p-3', className)}>
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-orange">
          <span>Mermaid 图表解析中 / 语法待完善</span>
        </div>
        <pre className="m-0 overflow-x-auto font-mono text-[11.5px] text-ink-2">
          {chart}
        </pre>
      </div>
    );
  }

  if (!svgHtml) {
    return (
      <div className={cn('my-2 rounded-card border border-line bg-inset p-3 text-[12px] text-ink-3', className)}>
        正在渲染图表…
      </div>
    );
  }

  return (
    <div
      className={cn(
        'my-2 flex justify-center overflow-x-auto rounded-card border border-line bg-surface p-3 shadow-xs',
        className,
      )}
      data-testid="mermaid-diagram"
      // Sanitized strictly via DOMPurify SVG profile above
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}

