import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import {
  Bold,
  CheckSquare,
  Code,
  Download,
  Eye,
  FileCode,
  GitBranch,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  ListTree,
  PenLine,
  Quote,
  Redo2,
  Save,
  Strikethrough,
  Table as TableIcon,
  TerminalSquare,
  Undo2,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/Button.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { MermaidDiagram } from './MermaidDiagram.js';

const lowlight = createLowlight(common);

export type MarkdownEditorMode = 'RICH' | 'SOURCE' | 'PREVIEW';

export interface TiptapMarkdownEditorProps {
  value: string;
  onChange: (nextMarkdown: string) => void;
  onSave?: (currentMarkdown: string) => void | Promise<void>;
  saveLabel?: string;
  saving?: boolean;
  title?: string;
  badge?: React.ReactNode;
  placeholder?: string;
  readOnly?: boolean;
  defaultMode?: MarkdownEditorMode;
  minHeight?: number;
  downloadFilename?: string;
  extraActions?: React.ReactNode;
  testId?: string;
  sourceTextareaTestId?: string;
  saveBtnTestId?: string;
  className?: string;
}

interface HeadingOutlineItem {
  level: number;
  text: string;
  line: number;
}

function extractOutline(markdown: string): HeadingOutlineItem[] {
  const items: HeadingOutlineItem[] = [];
  const lines = markdown.split('\n');
  let inCodeFence = false;
  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence) return;
    const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (match) {
      items.push({
        level: match[1].length,
        text: match[2].replace(/[`*_~]/g, '').trim(),
        line: index + 1,
      });
    }
  });
  return items;
}

function extractMermaidBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```mermaid\s*\n([\s\S]*?)```/gi;
  for (const m of markdown.matchAll(regex)) {
    if (m[1]?.trim()) blocks.push(m[1].trim());
  }
  return blocks;
}

export function TiptapMarkdownEditor({
  value,
  onChange,
  onSave,
  saveLabel = '保存文档',
  saving = false,
  title,
  badge,
  placeholder = '在此输入结构化 Markdown 内容（支持标题、表格、任务清单、代码块与 Mermaid 图表）…',
  readOnly = false,
  defaultMode = 'RICH',
  minHeight = 360,
  downloadFilename,
  extraActions,
  testId = 'tiptap-markdown-editor',
  sourceTextareaTestId,
  saveBtnTestId,
  className,
}: TiptapMarkdownEditorProps) {
  const [mode, setMode] = useState<MarkdownEditorMode>(readOnly ? 'PREVIEW' : defaultMode);
  const [showOutline, setShowOutline] = useState(false);
  const lastEmittedRef = useRef<string>(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Markdown,
      TableKit.configure({
        table: { resizable: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      CodeBlockLowlight.configure({ lowlight }),
    ],
    content: value || '',
    contentType: 'markdown',
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      const md = ed.getMarkdown();
      lastEmittedRef.current = md;
      onChange(md);
    },
  });

  // Sync external `value` changes (e.g. switching selected document or AI synthesis)
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    editor.commands.setContent(value || '', { contentType: 'markdown' });
  }, [editor, value]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly && mode === 'RICH');
    }
  }, [editor, readOnly, mode]);

  const outline = useMemo(() => extractOutline(value || ''), [value]);
  const mermaidBlocks = useMemo(() => extractMermaidBlocks(value || ''), [value]);

  const handleModeSwitch = (nextMode: MarkdownEditorMode) => {
    if (nextMode === 'RICH' && editor && value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      editor.commands.setContent(value || '', { contentType: 'markdown' });
    }
    setMode(nextMode);
  };

  const handleDownload = () => {
    const blob = new Blob([value || ''], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFilename || `${(title || 'document').replace(/\s+/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const insertMermaidSnippet = () => {
    const snippet = `\n\`\`\`mermaid\nflowchart LR\n  M1["M1 对象概念"] --> M2["M2 行为规则"]\n  M2 --> M5["M5 场景编排"]\n\`\`\`\n`;
    if (mode === 'RICH' && editor) {
      editor.commands.insertContent(snippet, { contentType: 'markdown' });
    } else {
      const next = `${value || ''}${snippet}`;
      lastEmittedRef.current = next;
      onChange(next);
    }
  };

  const charCount = (value || '').length;
  const lineCount = (value || '').split('\n').length;

  return (
    <div
      className={cn(
        'tiptap-editor-root flex flex-col overflow-hidden rounded-window border border-line bg-surface shadow-card',
        className,
      )}
      data-testid={testId}
    >
      {/* Top Mode & Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-inset/45 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {title && <span className="text-[13px] font-semibold text-ink">{title}</span>}
          {badge}

          {/* 3-Mode Segmented Control */}
          <div className="inline-flex items-center rounded-[7px] border border-line bg-surface p-0.5 shadow-2xs">
            {!readOnly && (
              <button
                type="button"
                data-testid="md-mode-rich"
                onClick={() => handleModeSwitch('RICH')}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-[5px] px-2.5 text-[11.5px] font-medium cursor-pointer transition-colors',
                  mode === 'RICH'
                    ? 'bg-surface text-ink shadow-hairline'
                    : 'text-ink-3 hover:text-ink',
                )}
              >
                <PenLine size={11.5} />
                富文本
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                data-testid="md-mode-source"
                onClick={() => handleModeSwitch('SOURCE')}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-[5px] px-2.5 text-[11.5px] font-medium cursor-pointer transition-colors',
                  mode === 'SOURCE'
                    ? 'bg-surface text-ink shadow-hairline'
                    : 'text-ink-3 hover:text-ink',
                )}
              >
                <FileCode size={11.5} />
                Markdown 源码
              </button>
            )}
            <button
              type="button"
              data-testid="md-mode-preview"
              onClick={() => handleModeSwitch('PREVIEW')}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-[5px] px-2.5 text-[11.5px] font-medium cursor-pointer transition-colors',
                mode === 'PREVIEW'
                  ? 'bg-surface text-ink shadow-hairline'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              <Eye size={11.5} />
              阅读预览
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {outline.length > 0 && (
            <Button
              variant={showOutline ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setShowOutline((v) => !v)}
              title="切换目录大纲"
            >
              <ListTree size={12.5} />
              大纲 ({outline.length})
            </Button>
          )}
          <Button variant="ghost" size="xs" onClick={handleDownload} title="导出 .md 文件">
            <Download size={12.5} />
            .md
          </Button>
          {extraActions}
          {onSave && !readOnly && (
            <Button
              variant="accent"
              size="xs"
              disabled={saving}
              onClick={() => void onSave(value)}
              data-testid={saveBtnTestId}
            >
              <Save size={12.5} />
              {saving ? '保存中…' : saveLabel}
            </Button>
          )}
        </div>
      </div>

      {/* Rich Formatting Toolbar */}
      {!readOnly && mode === 'RICH' && editor && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface px-2.5 py-1.5">
          <ToolbarBtn
            active={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title="一级标题 (H1)"
          >
            <Heading1 size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="二级标题 (H2)"
          >
            <Heading2 size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title="三级标题 (H3)"
          >
            <Heading3 size={13.5} />
          </ToolbarBtn>

          <span className="mx-1 h-4 w-px bg-line" />

          <ToolbarBtn
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="加粗"
          >
            <Bold size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="斜体"
          >
            <Italic size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="删除线"
          >
            <Strikethrough size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('code')}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="行内代码"
          >
            <Code size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="引用块"
          >
            <Quote size={13.5} />
          </ToolbarBtn>

          <span className="mx-1 h-4 w-px bg-line" />

          <ToolbarBtn
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="无序列表"
          >
            <List size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="有序列表"
          >
            <ListOrdered size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('taskList')}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            title="任务检查项"
          >
            <CheckSquare size={13.5} />
          </ToolbarBtn>

          <span className="mx-1 h-4 w-px bg-line" />

          <ToolbarBtn
            active={editor.isActive('table')}
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
            title="插入 3×3 表格"
          >
            <TableIcon size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="代码块"
          >
            <TerminalSquare size={13.5} />
          </ToolbarBtn>
          <ToolbarBtn active={false} onClick={insertMermaidSnippet} title="插入 Mermaid 架构图">
            <GitBranch size={13.5} />
          </ToolbarBtn>

          <span className="ml-auto flex items-center gap-0.5">
            <ToolbarBtn
              active={false}
              onClick={() => editor.chain().focus().undo().run()}
              title="撤销"
            >
              <Undo2 size={13.5} />
            </ToolbarBtn>
            <ToolbarBtn
              active={false}
              onClick={() => editor.chain().focus().redo().run()}
              title="重做"
            >
              <Redo2 size={13.5} />
            </ToolbarBtn>
          </span>
        </div>
      )}

      {/* Main Content Body + Optional Collapsible TOC Outline */}
      <div className="flex flex-1 min-h-0" style={{ minHeight }}>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {mode === 'RICH' && (
            <div>
              <EditorContent editor={editor} />
              {mermaidBlocks.length > 0 && (
                <div className="border-t border-line bg-inset/30 px-4 py-3">
                  <div className="mb-2 text-[11.5px] font-semibold text-ink-3">
                    实时 Mermaid 架构图预览 ({mermaidBlocks.length})
                  </div>
                  <div className="space-y-2">
                    {mermaidBlocks.map((chart, idx) => (
                      <MermaidDiagram key={idx} chart={chart} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === 'SOURCE' && (
            <textarea
              data-testid={sourceTextareaTestId || 'md-source-textarea'}
              value={value}
              readOnly={readOnly}
              onChange={(e) => {
                const next = e.target.value;
                lastEmittedRef.current = next;
                onChange(next);
              }}
              placeholder={placeholder}
              spellCheck={false}
              style={{ minHeight }}
              className="block w-full resize-y border-0 bg-field p-4 font-mono text-[12.5px] leading-[1.65] text-ink focus:outline-none"
            />
          )}

          {mode === 'PREVIEW' && (
            <div className="p-5">
              {value?.trim() ? (
                <MarkdownRenderer content={value} />
              ) : (
                <div className="text-[12.5px] text-ink-3">{placeholder}</div>
              )}
            </div>
          )}
        </div>

        {showOutline && outline.length > 0 && (
          <aside className="w-56 shrink-0 overflow-y-auto border-l border-line bg-inset/35 p-3">
            <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">
              文档目录大纲
            </div>
            <div className="space-y-1">
              {outline.map((item, idx) => (
                <div
                  key={`${item.line}-${idx}`}
                  style={{ paddingLeft: `${(item.level - 1) * 10}px` }}
                  className="truncate text-[12.5px] text-ink-2"
                  title={item.text}
                >
                  <span className="mr-1 font-mono text-[10.5px] text-ink-3">
                    H{item.level}
                  </span>
                  {item.text}
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* Footer Metrics Bar */}
      <div className="flex items-center justify-between border-t border-line bg-inset/35 px-3 py-1.5 font-mono text-[11.5px] text-ink-3">
        <span>
          模式: {mode === 'RICH' ? 'Tiptap WYSIWYG' : mode === 'SOURCE' ? 'Markdown Raw' : 'GFM Preview'}
        </span>
        <span>
          {lineCount} 行 · {charCount} 字符
        </span>
      </div>
    </div>
  );
}

function ToolbarBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-control cursor-pointer transition-colors duration-120',
        active
          ? 'bg-accent-tint text-accent'
          : 'text-ink-2 hover:bg-hover hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

