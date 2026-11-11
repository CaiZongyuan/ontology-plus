import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils.js';
import { CodeBlock } from '../beautifui/CodeBlock.js';
import { MermaidDiagram } from './MermaidDiagram.js';

export interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
  testId?: string;
}

export function MarkdownRenderer({
  content,
  isStreaming = false,
  className,
  testId,
}: MarkdownRendererProps) {
  return (
    <div
      className={cn('md-prose text-[13px] leading-[1.65] text-ink break-words', className)}
      data-testid={testId}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table({ children }) {
            return (
              <div
                className="responsive-table-region my-2 rounded-card border border-line"
                role="region"
                aria-label="Markdown data table"
                tabIndex={0}
              >
                <table className="!m-0 !border-0">{children}</table>
              </div>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
          code(props) {
            const { className: codeClass, children, ...rest } = props;
            const match = /language-([\w-]+)/.exec(codeClass || '');
            const rawText = String(children ?? '').replace(/\n$/, '');
            const isBlock = Boolean(match || rawText.includes('\n'));

            if (!isBlock) {
              return (
                <code className={codeClass} {...rest}>
                  {children}
                </code>
              );
            }

            const lang = match?.[1]?.toLowerCase() ?? 'text';
            if (lang === 'mermaid') {
              return <MermaidDiagram chart={rawText} />;
            }

            return <CodeBlock code={rawText} language={lang} />;
          },
          a({ href, children, ...rest }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                {...rest}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content || ''}
      </ReactMarkdown>
      {isStreaming && <span className="stream-caret is-streaming" aria-hidden="true" />}
    </div>
  );
}

