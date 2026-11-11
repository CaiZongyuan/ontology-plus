import { describe, expect, it } from 'vitest';
import { extractMuFromPrototypeHtml } from '../../../packages/ontology-core/index.js';
import {
  computeFloatingPopoverPosition,
  createSandboxOriginValidator,
  injectVisualInspectorIntoHtml,
  sanitizeInspectorSelectionPayload,
  stripVisualInspectorFromHtml,
  toRefinementSelections,
  type PrototypeSelectionTarget,
  type PrototypeVisualAnnotation,
} from './PrototypeVisualInspector.js';

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
});
