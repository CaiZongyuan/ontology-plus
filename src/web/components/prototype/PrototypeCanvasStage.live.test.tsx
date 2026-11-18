// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyPrototypeLiveEvent,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  type PrototypeLiveState,
} from '../../../packages/ontology-core/index.js';
import type { InteractivePrototype, ProjectDetail } from '../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../i18n.js';
import { PrototypeCanvasStage } from './PrototypeCanvasStage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A page written in one go (no prototype shell): imports, rewrite_prototype_page, concurrency 1. */
const PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><style>body{margin:0}</style></head><body>
<section data-screen-id="SCR-MAIN" data-screen-name="合同台账"><h1>合同台账</h1><button type="button" data-element-id="EL-NEW" data-element-type="BUTTON">新建</button></section>
</body></html>`;
const EDITED = PAGE.replace(
  '新建</button>',
  '新建</button><button type="button" data-element-id="EL-ARCHIVE" data-element-type="BUTTON">归档筛选</button>',
);

function proto(html: string, rev: number): InteractivePrototype {
  return {
    id: 'proto-page',
    projectId: 'proj-1',
    name: '合同台账原型',
    revisions: [
      {
        id: `rev-${rev}`,
        prototypeId: 'proto-page',
        projectId: 'proj-1',
        revisionNumber: rev,
        title: `R${rev}`,
        htmlContent: html,
        extractedScreenCount: 1,
        source: 'GENERATED',
        createdAt: '2026-11-18T10:00:00.000Z',
      },
    ],
    currentRevisionId: `rev-${rev}`,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    version: `r${rev}`,
    htmlContent: html,
    extractedScreenCount: 1,
    isConfirmed: false,
    aheadOfConfirmedCount: 0,
  };
}

const project = {
  id: 'proj-1',
  name: '合同管理',
  code: 'CLM',
  center: 'APPLICATION',
  domain: '合同管理',
  description: '',
  currentStage: 2,
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
  suite: {},
  validation: { valid: true, errorCount: 0, warningCount: 0, diagnostics: [], presentModels: [], missingModels: [] },
} as unknown as ProjectDetail;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(prototype: InteractivePrototype, liveState: PrototypeLiveState | null, busy: boolean) {
  await act(async () => {
    root.render(
      <PreferencesProvider>
        <PrototypeCanvasStage
          project={project}
          prototypes={[prototype]}
          selectedPrototypeId={prototype.id}
          confirmedRevision={null}
          onSelectPrototype={() => undefined}
          onPrototypesUpdated={() => undefined}
          onBackToBrief={() => undefined}
          liveState={liveState}
          busy={busy}
          containerWidthOverride={960}
        />
      </PreferencesProvider>,
    );
  });
}

function previewSrcDoc(): string {
  return Array.from(host.querySelectorAll('iframe'))
    .map((f) => f.getAttribute('srcdoc') ?? '')
    .join('\n');
}

describe('PrototypeCanvasStage: a run never changes the layout (#89 review P4)', () => {
  it('an edit run on a page without the shell stays in the single-page view and shows the live change', async () => {
    await render(proto(PAGE, 1), null, false);
    const single = host.querySelector('[data-testid="prototype-visual-stage"]');
    expect(single).not.toBeNull();
    expect(host.querySelector('[data-testid="prototype-live-canvas"]')).toBeNull();

    // the run starts and edits the page
    const tracker = createPrototypeLiveTracker();
    tracker.reset(PAGE);
    let live = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(EDITED)) live = applyPrototypeLiveEvent(live, ev);
    expect(live.screens['SCR-MAIN']).toBeDefined();
    await render(proto(PAGE, 1), live, true);
    expect(host.querySelector('[data-testid="prototype-visual-stage"]')).toBe(single);
    expect(host.querySelector('[data-testid="prototype-live-canvas"]')).toBeNull();
    expect(previewSrcDoc()).toContain('归档筛选');
    expect(host.textContent).not.toContain('正在规划要画哪几屏');

    // the run ends and the revision is saved
    await render(proto(EDITED, 2), null, false);
    expect(host.querySelector('[data-testid="prototype-visual-stage"]')).toBe(single);
    expect(previewSrcDoc()).toContain('归档筛选');
  });
});
