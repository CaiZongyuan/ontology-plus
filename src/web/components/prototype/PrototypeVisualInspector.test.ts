import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractMuFromPrototypeHtml } from '../../../packages/ontology-core/index.js';
import { PreferencesProvider } from '../../i18n.js';
import {
  PROTOTYPE_VIEWPORT_WIDTHS,
  PrototypeVisualPreviewStage,
  computeFloatingPopoverPosition,
  computeViewportFitScale,
  createSandboxOriginValidator,
  injectVisualInspectorIntoHtml,
  mapIframeRectToStageRect,
  openCleanPrototypeInNewTab,
  sanitizeInspectorSelectionPayload,
  stripVisualInspectorFromHtml,
  toRefinementSelections,
  type PrototypeSelectionTarget,
  type PrototypeVisualAnnotation,
} from './PrototypeVisualInspector.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE_PROTOTYPE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>合同工作台</title></head>
<body>
  <section data-screen-id="SCR-CONTRACT-LIST" data-screen-name="合同台账" data-screen-type="LIST" data-screen-route="/contracts">
    <input data-element-id="EL-SEARCH" data-element-name="keyword" data-element-label="检索合同" data-element-type="INPUT" data-binding="Contract.title" />
    <button type="button" data-element-id="EL-APPROVE" data-element-name="approveBtn" data-element-label="批量审批" data-element-type="BUTTON" data-event-id="UIE-APPROVE">审批</button>
  </section>
</body>
</html>`;

describe('PrototypeVisualInspector helpers', () => {
  it('injects preview-only inspector script without polluting MU extraction and strips cleanly', () => {
    const baselineMu = extractMuFromPrototypeHtml(SAMPLE_PROTOTYPE_HTML, '合同管理');
    const injected = injectVisualInspectorIntoHtml(SAMPLE_PROTOTYPE_HTML, {
      token: 'tok-abc</script>',
      targetOrigin: 'http://localhost:5173',
      initialActive: true,
      locale: 'zh-CN',
    });

    expect(injected).toContain('data-onto-visual-inspector="1"');
    // Escapes `<` inside JSON config so embedded `</script>` cannot break script tag boundaries
    expect(injected).toContain('tok-abc\\u003c/script>');
    expect(injected.indexOf('data-onto-visual-inspector="1"')).toBeLessThan(
      injected.lastIndexOf('</body>'),
    );

    const extractedWithInspector = extractMuFromPrototypeHtml(injected, '合同管理');
    expect(extractedWithInspector.screens).toEqual(baselineMu.screens);

    const stripped = stripVisualInspectorFromHtml(injected);
    expect(stripped).not.toContain('data-onto-visual-inspector');
    expect(stripped.trim()).toBe(SAMPLE_PROTOTYPE_HTML.trim());
  });

  it('validates sandboxed postMessage events by source window, token, and opaque Origin pinning', () => {
    const fakeIframeWin = {} as WindowProxy;
    const otherIframeWin = {} as WindowProxy;

    const validator = createSandboxOriginValidator();
    const validEvent = {
      source: fakeIframeWin,
      origin: 'null',
      data: { namespace: 'ONTO_PROTO_INSPECTOR', token: 'secret-1', type: 'READY' },
    } as unknown as MessageEvent;

    expect(validator.verify(validEvent, fakeIframeWin, 'secret-1')).toBe(true);
    expect(validator.verify(validEvent, otherIframeWin, 'secret-1')).toBe(false);
    expect(validator.verify(validEvent, fakeIframeWin, 'wrong-token')).toBe(false);
  });

  it('sanitizes selection payloads and rejects malformed messages', () => {
    expect(sanitizeInspectorSelectionPayload(null)).toBeNull();
    expect(
      sanitizeInspectorSelectionPayload({
        kind: 'ELEMENT',
        cssSelector: '',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      }),
    ).toBeNull();

    const clean = sanitizeInspectorSelectionPayload({
      kind: 'REGION',
      tagName: 'SECTION',
      cssSelector: '[data-screen-id="SCR-CONTRACT-LIST"]',
      label: '  框选 2 个控件  ',
      textPreview: '检索合同 / 审批',
      htmlSnippet: '<input /><button>审批</button>',
      screenId: 'SCR-CONTRACT-LIST',
      matchedElementCount: 2,
      matchedElementsSummary: ['SCR-CONTRACT-LIST · EL-SEARCH', 'SCR-CONTRACT-LIST · EL-APPROVE'],
      rect: { x: 24, y: 80, width: 320, height: 64 },
    });

    expect(clean).not.toBeNull();
    expect(clean?.kind).toBe('REGION');
    expect(clean?.tagName).toBe('section');
    expect(clean?.label).toBe('框选 2 个控件');
    expect(clean?.screenId).toBe('SCR-CONTRACT-LIST');
    expect(clean?.matchedElementCount).toBe(2);
  });

  it('flips floating popover above target when near bottom edge and clamps horizontally', () => {
    const belowPos = computeFloatingPopoverPosition(
      { x: 40, y: 60, width: 140, height: 36 },
      { width: 700, height: 560 },
      36,
    );
    expect(belowPos.left).toBe(40);
    expect(belowPos.top).toBe(60 + 36 + 36 + 8);

    const flippedAbove = computeFloatingPopoverPosition(
      { x: 620, y: 420, width: 120, height: 48 },
      { width: 700, height: 560 },
      36,
    );
    expect(flippedAbove.left).toBeLessThanOrEqual(700 - 388 - 12);
    expect(flippedAbove.top).toBeLessThan(420 + 36);
  });

  it('merges pinned annotations and active draft without duplicating identical targets', () => {
    const targetA: PrototypeSelectionTarget = {
      kind: 'ELEMENT',
      tagName: 'button',
      cssSelector: 'button[data-element-id="EL-APPROVE"]',
      label: '批量审批',
      textPreview: '审批',
      htmlSnippet: '<button data-element-id="EL-APPROVE">审批</button>',
      screenId: 'SCR-CONTRACT-LIST',
      elementId: 'EL-APPROVE',
      rect: { x: 20, y: 40, width: 88, height: 32 },
    };
    const annotations: PrototypeVisualAnnotation[] = [
      { id: 'a1', index: 1, target: targetA, note: '改为危险红底并补充二次确认浮层' },
    ];

    const deduped = toRefinementSelections(annotations, { target: targetA, note: '重复项' });
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.note).toBe('改为危险红底并补充二次确认浮层');
  });

  it('computes responsive viewport widths and auto-fit scale across Desktop (1440), Tablet (768), and Mobile (390)', () => {
    expect(PROTOTYPE_VIEWPORT_WIDTHS).toEqual({
      DESKTOP: 1440,
      TABLET: 768,
      MOBILE: 390,
    });

    // Desktop 1440 inside a 960px container (minus 24px padding = 936px available -> 936 / 1440 = 0.65)
    const desktopFit = computeViewportFitScale(960, 'DESKTOP', 'FIT');
    expect(desktopFit.targetWidth).toBe(1440);
    expect(desktopFit.scale).toBe(0.65);
    expect(desktopFit.scaledWidth).toBe(936);

    // Desktop 1440 in ACTUAL (100%) mode stays unscaled at 1
    const desktopActual = computeViewportFitScale(960, 'DESKTOP', 'ACTUAL');
    expect(desktopActual.targetWidth).toBe(1440);
    expect(desktopActual.scale).toBe(1);
    expect(desktopActual.scaledWidth).toBe(1440);

    // Tablet 768 inside a 960px container does not upscale past 1
    const tabletWide = computeViewportFitScale(960, 'TABLET', 'FIT');
    expect(tabletWide.targetWidth).toBe(768);
    expect(tabletWide.scale).toBe(1);
    expect(tabletWide.scaledWidth).toBe(768);

    // Tablet 768 inside a narrower 600px container scales down cleanly ((600 - 24) / 768 = 0.75)
    const tabletNarrow = computeViewportFitScale(600, 'TABLET', 'FIT');
    expect(tabletNarrow.targetWidth).toBe(768);
    expect(tabletNarrow.scale).toBe(0.75);
    expect(tabletNarrow.scaledWidth).toBe(576);

    // Mobile 390 inside a 960px container stays crisp at 1 (390px)
    const mobileWide = computeViewportFitScale(960, 'MOBILE', 'FIT');
    expect(mobileWide.targetWidth).toBe(390);
    expect(mobileWide.scale).toBe(1);
    expect(mobileWide.scaledWidth).toBe(390);

    // Maps iframe coordinates to host stage coordinates under auto-fit scale + centering offset
    const mapped = mapIframeRectToStageRect(
      { x: 100, y: 200, width: 300, height: 80 },
      0.5,
      40,
    );
    expect(mapped).toEqual({ x: 90, y: 100, width: 150, height: 40 });
  });

  it('opens clean prototype HTML in a new tab via Blob URL with inspector script stripped', () => {
    const injected = injectVisualInspectorIntoHtml(SAMPLE_PROTOTYPE_HTML, {
      token: 'tok-tab-test',
      targetOrigin: 'http://localhost:5173',
      initialActive: true,
      locale: 'zh-CN',
    });
    expect(injected).toContain('data-onto-visual-inspector="1"');

    const capturedBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlobs.push(blob);
      return 'blob:http://localhost:5173/clean-proto-1';
    });
    const revokeObjectURL = vi.fn();
    const openSpy = vi.fn();

    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    vi.stubGlobal('window', {
      open: openSpy,
    });

    const res = openCleanPrototypeInNewTab(injected);
    expect(res).not.toBeNull();
    expect(res?.blobUrl).toBe('blob:http://localhost:5173/clean-proto-1');
    expect(res?.cleanHtml).not.toContain('data-onto-visual-inspector');
    expect(res?.cleanHtml.trim()).toBe(SAMPLE_PROTOTYPE_HTML.trim());
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(capturedBlobs[0]?.type).toBe('text/html;charset=utf-8');
    expect(openSpy).toHaveBeenCalledWith(
      'blob:http://localhost:5173/clean-proto-1',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('renders PrototypeVisualPreviewStage across Desktop, Tablet, and Mobile viewports with auto-fit scaling', () => {
    const noop = () => {};
    const desktopHtml = renderToStaticMarkup(
      React.createElement(
        PreferencesProvider,
        null,
        React.createElement(PrototypeVisualPreviewStage, {
          htmlContent: SAMPLE_PROTOTYPE_HTML,
          inspectMode: false,
          onInspectModeChange: noop,
          viewport: 'DESKTOP',
          zoomMode: 'FIT',
          containerWidthOverride: 960,
          fillHeight: true,
        }),
      ),
    );
    expect(desktopHtml).toContain('data-viewport="DESKTOP"');
    expect(desktopHtml).toContain('data-zoom-mode="FIT"');
    expect(desktopHtml).toContain('data-scale="0.65"');
    expect(desktopHtml).toContain('width:1440px');
    expect(desktopHtml).toContain('scale(0.65)');

    const mobileHtml = renderToStaticMarkup(
      React.createElement(
        PreferencesProvider,
        null,
        React.createElement(PrototypeVisualPreviewStage, {
          htmlContent: SAMPLE_PROTOTYPE_HTML,
          inspectMode: true,
          onInspectModeChange: noop,
          viewport: 'MOBILE',
          zoomMode: 'FIT',
          containerWidthOverride: 960,
        }),
      ),
    );
    expect(mobileHtml).toContain('data-viewport="MOBILE"');
    expect(mobileHtml).toContain('width:390px');
    expect(mobileHtml).toContain('data-testid="visual-select-banner"');
  });
});
