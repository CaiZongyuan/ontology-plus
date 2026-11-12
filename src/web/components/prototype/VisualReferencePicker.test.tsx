import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../i18n.js';
import { PrototypeCoDesignStudio } from './PrototypeCoDesignStudio.js';
import {
  CURATED_INSPO_CATALOG,
  MAX_BORROWED_REFERENCES,
  VisualReferencePicker,
  createInitialVisualReferenceSelection,
  fetchVisualReferenceCatalog,
  removeBorrowedReference,
  selectPrimaryReference,
  setBorrowedReferenceAspect,
  upsertBorrowedReference,
  type VisualReferenceSelection,
} from './VisualReferencePicker.js';

const noop = () => {};

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

function renderPicker(selection: VisualReferenceSelection, onContinue = noop): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <VisualReferencePicker
        selection={selection}
        onSelectionChange={noop}
        onContinue={onContinue}
      />
    </PreferencesProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VisualReferencePicker & Primary/Borrowed selection model', () => {
  it('is ready to proceed immediately with 1 Primary Reference and keeps optional Borrowed References and advanced filters collapsed by default', () => {
    stubLocale('zh-CN');
    const initial = createInitialVisualReferenceSelection(CURATED_INSPO_CATALOG[3]!); // Increase
    const html = renderPicker(initial);

    expect(initial.primary.slug).toBe('increase-com');
    expect(initial.borrowed).toHaveLength(0);

    // Primary Reference summary & immediate continue button enabled
    expect(html).toContain('data-testid="primary-reference-summary"');
    expect(html).toContain('主参考');
    expect(html).toContain('Increase');
    expect(html).toContain('data-testid="visual-ref-continue-btn"');
    expect(html).not.toMatch(/data-testid="visual-ref-continue-btn"[^>]*disabled/);

    // Optional Borrowed References & Advanced Filters exist inside <details>, ALL collapsed by default
    expect(html).toContain('data-testid="visual-ref-borrowed-disclosure"');
    expect(html).toContain('data-testid="visual-ref-advanced-filters"');
    expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
  });

  it('enforces max 2 Borrowed References distinct from Primary Reference and strictly 1 aspect per Borrowed Reference', () => {
    const [amie, cleanshot, capacities, increase] = CURATED_INSPO_CATALOG;
    let sel = createInitialVisualReferenceSelection(increase!);

    // Cannot add Primary Reference itself as a Borrowed Reference
    sel = upsertBorrowedReference(sel, increase!, 'bgColor');
    expect(sel.borrowed).toHaveLength(0);

    // Add Borrowed Reference #1 with 'accentColor'
    sel = upsertBorrowedReference(sel, amie!, 'accentColor');
    expect(sel.borrowed).toHaveLength(1);
    expect(sel.borrowed[0]?.item.slug).toBe('amie-so');
    expect(sel.borrowed[0]?.aspect).toBe('accentColor');

    // Selecting a different aspect on Borrowed Reference #1 REPLACES its single aspect (never multi-select)
    sel = setBorrowedReferenceAspect(sel, 'amie-so', 'spacing');
    expect(sel.borrowed[0]?.aspect).toBe('spacing');

    // Add Borrowed Reference #2 with 'typography'
    sel = upsertBorrowedReference(sel, cleanshot!, 'typography');
    expect(sel.borrowed).toHaveLength(MAX_BORROWED_REFERENCES);
    expect(sel.borrowed[1]?.item.slug).toBe('cleanshot-com');
    expect(sel.borrowed[1]?.aspect).toBe('typography');

    // Attempting to add a 3rd Borrowed Reference is blocked at max 2
    sel = upsertBorrowedReference(sel, capacities!, 'cardBorder');
    expect(sel.borrowed).toHaveLength(2);
    expect(sel.borrowed.map((b) => b.item.slug)).toEqual(['amie-so', 'cleanshot-com']);

    // Rendered UI shows strictly 1 checked radio per Borrowed Reference and disables adding a 3rd
    stubLocale('zh-CN');
    const htmlWithTwoBorrowed = renderPicker(sel);
    const checkedRadios = htmlWithTwoBorrowed.match(/role="radio"[^>]*aria-checked="true"/g) ?? [];
    expect(checkedRadios).toHaveLength(2);
    expect(htmlWithTwoBorrowed).toMatch(
      /data-testid="add-borrowed-ref-capacities-io"[^>]*disabled/,
    );

    // Promoting a Borrowed Reference to Primary Reference removes it from Borrowed References
    sel = selectPrimaryReference(sel, amie!);
    expect(sel.primary.slug).toBe('amie-so');
    expect(sel.borrowed.map((b) => b.item.slug)).toEqual(['cleanshot-com']);

    // Removing the remaining Borrowed Reference leaves 0 borrowed
    sel = removeBorrowedReference(sel, 'cleanshot-com');
    expect(sel.borrowed).toHaveLength(0);
  });

  it('displays Inspo attribution and source website domain + clickable external link on every card in zh-CN and en-US', () => {
    const selection = createInitialVisualReferenceSelection(CURATED_INSPO_CATALOG[0]!);

    stubLocale('zh-CN');
    const zhHtml = renderPicker(selection);
    expect(zhHtml).toContain('data-testid="inspo-attribution"');
    expect(zhHtml).toContain('推荐由 Inspo 提供');

    for (const item of CURATED_INSPO_CATALOG) {
      expect(zhHtml).toContain(`data-testid="visual-ref-source-link-${item.slug}"`);
      expect(zhHtml).toContain(`href="${item.sourceUrl}"`);
      expect(zhHtml).toContain(item.sourceDomain);
    }
    expect(zhHtml).toContain('target="_blank"');
    expect(zhHtml).toContain('rel="noreferrer"');

    stubLocale('en-US');
    const enHtml = renderPicker(selection);
    expect(enHtml).toContain('Recommendations powered by Inspo');
    expect(enHtml).toContain('Primary Reference');
    expect(enHtml).toContain('href="https://increase.com"');
    expect(enHtml).toContain('increase.com');
  });

  it('falls back to built-in CURATED_INSPO_CATALOG when client fetch fails offline', async () => {
    const offlineFetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const res = await fetchVisualReferenceCatalog(
      { action: 'recommend', projectId: 'proj-contract' },
      offlineFetch as unknown as typeof fetch,
    );

    expect(res.fallback).toBe(true);
    expect(res.source).toBe('curated');
    expect(res.items.length).toBe(CURATED_INSPO_CATALOG.length);
    expect(res.items[0]?.sourceUrl).toMatch(/^https:\/\//);
  });

  it('integrates cleanly into PrototypeCoDesignStudio Stage 1 with Primary Reference ready and disclosures collapsed', () => {
    stubLocale('zh-CN');
    const mockProject: ProjectDetail = {
      id: 'proj-test',
      name: '示例业务工程',
      code: 'PROJ_TEST',
      center: 'APPLICATION',
      domain: 'saas',
      description: '',
      currentStage: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      suite: {},
      validation: {
        valid: true,
        errorCount: 0,
        warningCount: 0,
        diagnostics: [],
        presentModels: [],
        missingModels: [],
      },
      knowledgeGraph: { nodes: [], edges: [] },
      changelog: '',
    };

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCoDesignStudio
          project={mockProject}
          docs={[]}
          selectedDocId=""
          onSelectDocId={noop}
          prototypes={[]}
          selectedProtoId=""
          onSelectProtoId={noop}
          activeStep={1}
          onStepChange={noop}
          previewSource="REFERENCE_DRAFT"
          onPreviewSourceChange={noop}
          savedHtmlContent=""
          onSavedHtmlContentChange={noop}
          onDraftHtmlChange={noop}
          onSaveDraftAsPrototype={async () => {}}
          onGenerateWithAi={async () => {}}
          onCloneVersion={noop}
          onDeleteProto={noop}
          onDownloadHtml={noop}
          inspectMode={false}
          onInspectModeChange={noop}
          visualAnnotations={[]}
          onAddVisualAnnotation={noop}
          onRemoveVisualAnnotation={noop}
          onClearVisualAnnotations={noop}
          refineInstruction=""
          onRefineInstructionChange={noop}
          onApplyRefine={async () => {}}
          isBusyProto={false}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('data-testid="proto-step-1"');
    expect(html).toContain('data-testid="proto-next-to-step-2"');
    expect(html).toContain('data-testid="visual-ref-continue-btn"');
    expect(html).toContain('data-testid="inspo-attribution"');
    expect(html).toContain('推荐由 Inspo 提供');
    expect(html).toContain('href="https://amie.so"');
    expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
  });
});
