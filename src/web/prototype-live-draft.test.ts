import { describe, expect, it } from 'vitest';
import { createPrototypeLiveTracker } from '../packages/ontology-core/index.js';
import { applyPrototypeLiveEventToDraft, type SessionLiveDraft } from './api.js';

const DOC = `<html><head></head><body><main id="proto-screens-root"><section data-screen-id="SCR-A" data-screen-name="首页" data-screen-status="queued"></section></main></body></html>`;

describe('applyPrototypeLiveEventToDraft', () => {
  it('points the active anchor at the screen being written and releases it when that screen lands', () => {
    const tracker = createPrototypeLiveTracker();
    let draft: SessionLiveDraft = {
      runId: 'r',
      sessionId: 's',
      userPrompt: '',
      startedAt: 0,
      liveStatus: { zh: '', en: '' },
      thinking: '',
      text: '',
      steps: [],
    };
    for (const ev of tracker.observeDocument(DOC)) draft = applyPrototypeLiveEventToDraft(draft, ev);
    expect(draft.activeAnchor).toBeUndefined();
    draft = applyPrototypeLiveEventToDraft(draft, tracker.observePartialScreen({ screenId: 'SCR-A', partialHtml: '<p>早' })!);
    expect(draft.activeAnchor).toEqual({ screenId: 'SCR-A', label: '首页' });
    for (const ev of tracker.observeDocument(DOC.replace('data-screen-status="queued"></section>', 'data-screen-status="ready"><p>早上好</p></section>'))) {
      draft = applyPrototypeLiveEventToDraft(draft, ev);
    }
    expect(draft.activeAnchor).toBeUndefined();
    expect(draft.prototypeLive?.focusScreenId).toBeUndefined();
  });
});
