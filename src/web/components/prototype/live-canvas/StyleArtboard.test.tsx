// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyPrototypeLiveEvent,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  readStreamingPrototypeStyle,
  resolvePrototypeStyleValues,
  type PrototypeBuildState,
} from '../../../../packages/ontology-core/index.js';
import { checkBusinessViewMarkup } from '../../../../packages/business-vocabulary/index.js';
import { initPrototypeShell } from '../../../../packages/agent-runtime/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import { PrototypeLiveCanvas, type PrototypeLiveCanvasProps } from './PrototypeLiveCanvas.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STYLE = {
  direction: '墨绿配暖纸底色',
  values: resolvePrototypeStyleValues({ accent: '#2e6a4e', background: '#f5f3ee' }).values,
  componentCss: '.btn { background: var(--proto-accent); }',
  sampleHtml: '<section class="card"><button class="btn">提交订单</button></section>',
  locked: true,
};

const SAVED = initPrototypeShell(
  {
    appTitle: '门店订货',
    screens: [
      { screenId: 'SCR-A', screenName: '工作台首页', screenType: 'DASHBOARD' },
      { screenId: 'SCR-B', screenName: '订货单列表', screenType: 'LIST' },
    ],
  },
  { locale: 'zh-CN', style: STYLE },
).nextHtml;

let host: HTMLDivElement;
let root: Root;

async function render(props: PrototypeLiveCanvasProps) {
  await act(async () => {
    root.render(
      <PreferencesProvider>
        <PrototypeLiveCanvas {...props} />
      </PreferencesProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function leftOf(testId: string): number {
  return Number.parseFloat(host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.style.left);
}

describe('风格样张 on the live canvas (#91)', () => {
  it('is the first artboard of a saved prototype, drawn with the style’s own stylesheet', async () => {
    await render({ documentHtml: SAVED });
    const board = host.querySelector<HTMLElement>('[data-testid="prototype-style-artboard"]')!;
    expect(board.getAttribute('data-style-status')).toBe('ready');
    expect(board.getAttribute('data-style-locked')).toBe('true');
    // First slot; the screens come after it.
    expect(leftOf('prototype-style-artboard')).toBe(0);
    expect(leftOf('prototype-artboard-SCR-A')).toBeGreaterThan(0);
    const body = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-style-frame"]')!.contentDocument!.body;
    expect(body.innerHTML).toContain('提交订单');
    const label = host.querySelector('[data-testid="prototype-style-artboard-label"]')!;
    expect(label.textContent).toContain('风格样张');
    expect(label.textContent).toContain('用你确认的设计值');
    expect(checkBusinessViewMarkup(label.textContent ?? '', { plainText: true })).toHaveLength(0);
  });

  it('grows while the lead writes it and the follow camera aims at it', async () => {
    const tracker = createPrototypeLiveTracker();
    let state = emptyPrototypeLiveState();
    const stream = readStreamingPrototypeStyle({ values: { accent: '#2e6a4e' }, sampleHtml: '<section class="card"><button class="btn">提交' })!;
    state = applyPrototypeLiveEvent(state, tracker.observeStyle(stream, 'streaming')!);
    await render({ documentHtml: '', live: state, busy: true, building: true });
    const board = host.querySelector<HTMLElement>('[data-testid="prototype-style-artboard"]')!;
    expect(board.getAttribute('data-style-status')).toBe('streaming');
    const viewport = host.querySelector<HTMLElement>('[data-testid="prototype-canvas-viewport"]')!;
    expect(viewport.getAttribute('data-follow-target')).toBe('__style');
    expect(host.querySelector('[data-testid="prototype-style-artboard-label"]')!.textContent).toContain('正在画');
    // The "planning" placeholder is gone once something is drawn.
    expect(host.textContent).not.toContain('助手正在规划要画哪几屏');
  });

  it('the phase bar says whose values the style uses', async () => {
    const build: PrototypeBuildState = {
      startSeq: 1,
      plan: [{ screenId: 'SCR-A', screenName: '工作台首页', purpose: '店长看今天要做的事' }],
      planStreaming: false,
      planSeq: 2,
      screens: {},
      phases: {
        plan: { status: 'done', seq: 3 },
        style: { status: 'done', seq: 5 },
        screens: { status: 'not_started', seq: 0 },
        review: { status: 'not_started', seq: 0 },
        tours: { status: 'not_started', seq: 0 },
      },
      log: [{ id: 1, at: '', agent: 0, kind: 'style_ready', locked: false }],
    };
    await render({ documentHtml: SAVED, build });
    const phase = host.querySelector('[data-testid="prototype-phase-style"]')!;
    expect(phase.getAttribute('data-phase-status')).toBe('done');
    expect(phase.textContent).toContain('助手提出的设计值');
  });
});
