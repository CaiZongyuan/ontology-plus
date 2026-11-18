import { afterEach, describe, expect, it } from 'vitest';
import {
  CONVERSATION_DRAFT_STORAGE_KEY,
  EMPTY_CONVERSATION_DRAFT,
  clearConversationDraftMemoryForTests,
  clearSessionDraft,
  readSessionDraft,
  writeSessionDraft,
  type DraftStorageLike,
} from './draftStore.js';

function createMockStorage(initial: Record<string, string> = {}): DraftStorageLike & {
  dump: () => Record<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    dump: () => Object.fromEntries(store.entries()),
  };
}

describe('draftStore (#81)', () => {
  afterEach(() => {
    clearConversationDraftMemoryForTests();
  });

  it('persists and isolates unsent text and quoted snippets per sessionId across switches and reload', () => {
    const storage = createMockStorage();

    expect(readSessionDraft('sess-a', storage)).toEqual(EMPTY_CONVERSATION_DRAFT);

    writeSessionDraft(
      'sess-a',
      {
        text: '补充大额合同双签规则',
        quotes: ['普通采购由采购经理审批，超额采购由法务与财务双签。'],
      },
      storage,
    );
    writeSessionDraft(
      'sess-b',
      {
        text: '核对外币汇率锁定节点',
        quotes: [],
      },
      storage,
    );

    expect(readSessionDraft('sess-a', storage)).toEqual({
      text: '补充大额合同双签规则',
      quotes: ['普通采购由采购经理审批，超额采购由法务与财务双签。'],
    });
    expect(readSessionDraft('sess-b', storage)).toEqual({
      text: '核对外币汇率锁定节点',
      quotes: [],
    });

    // Simulate page reload: clear in-memory cache while preserving localStorage
    clearConversationDraftMemoryForTests();

    expect(storage.dump()[CONVERSATION_DRAFT_STORAGE_KEY]).toBeDefined();
    expect(readSessionDraft('sess-a', storage)).toEqual({
      text: '补充大额合同双签规则',
      quotes: ['普通采购由采购经理审批，超额采购由法务与财务双签。'],
    });
    expect(readSessionDraft('sess-b', storage)).toEqual({
      text: '核对外币汇率锁定节点',
      quotes: [],
    });
  });

  it('clears only the submitted session draft while keeping other sessions intact', () => {
    const storage = createMockStorage();
    writeSessionDraft('sess-a', { text: '草稿 A', quotes: ['引用片段 A'] }, storage);
    writeSessionDraft('sess-b', { text: '草稿 B', quotes: [] }, storage);

    clearSessionDraft('sess-a', storage);
    clearConversationDraftMemoryForTests();

    expect(readSessionDraft('sess-a', storage)).toEqual(EMPTY_CONVERSATION_DRAFT);
    expect(readSessionDraft('sess-b', storage)).toEqual({ text: '草稿 B', quotes: [] });

    // Writing an empty draft also deletes the entry cleanly
    writeSessionDraft('sess-b', { text: '', quotes: [] }, storage);
    clearConversationDraftMemoryForTests();
    expect(readSessionDraft('sess-b', storage)).toEqual(EMPTY_CONVERSATION_DRAFT);
  });

  it('falls back safely to memory when storage is unavailable, throws, or holds corrupted JSON', () => {
    const throwingStorage: DraftStorageLike = {
      getItem: () => {
        throw new Error('Quota / security error');
      },
      setItem: () => {
        throw new Error('Quota / security error');
      },
    };

    writeSessionDraft('sess-ssr', { text: '离线草稿', quotes: ['离线引用'] }, throwingStorage);
    expect(readSessionDraft('sess-ssr', throwingStorage)).toEqual({
      text: '离线草稿',
      quotes: ['离线引用'],
    });

    const corruptStorage = createMockStorage({
      [CONVERSATION_DRAFT_STORAGE_KEY]: '{not-valid-json',
    });
    expect(readSessionDraft('sess-any', corruptStorage)).toEqual(EMPTY_CONVERSATION_DRAFT);
  });
});
