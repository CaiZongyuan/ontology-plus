import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectUnifiedAgentTurn } from '../../../../packages/agent-runtime/index.js';
import { createWorkspaceStore } from '../../../../packages/workspace-store/index.js';
import { composePromptWithQuotes } from './quotedSelection.js';
import { summarizeTable, tableChipLabel } from './tableAttachment.js';

const customers = readFileSync(fileURLToPath(new URL('../../../../../benchmark/datasets/bb-seed0/customers.csv', import.meta.url)), 'utf8');

describe('a table attached to the requirements conversation (TeaCo spec U-01)', () => {
  it('sends the header, column types and first rows, not the file', () => {
    const zh = summarizeTable('customers.csv', customers, 'zh-CN')!;
    expect(zh.rows).toBe(150);
    expect(zh.text.split('\n')[0]).toBe('[附带表格：customers（150 行）]');
    expect(zh.text).toContain('列：');
    expect(zh.text.split('\n').filter((l) => l.startsWith('| '))).toHaveLength(7);
    expect(zh.text.length).toBeLessThan(2000);
    expect(tableChipLabel(zh.text)).toBe('customers · 150 行');
    expect(tableChipLabel(summarizeTable('customers.csv', customers, 'en-US')!.text)).toBe('customers · 150 rows');
    expect(tableChipLabel('an ordinary quote')).toBeNull();
    expect(summarizeTable('empty.csv', 'just-a-header\n', 'zh-CN')).toBeNull();
  });

  it('is answered from what was attached', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const session = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'REQUIREMENT', title: '需求' });
    const prompt = composePromptWithQuotes([summarizeTable('customers.csv', customers, 'zh-CN')!.text], '这是我们现在的客户表');
    const turn = await collectUnifiedAgentTurn(store, { sessionId: session.id, prompt, mockMode: true });
    const reply = turn.session.messages.at(-1)!.content;
    expect(reply).toContain('「customers」150 行');
    expect(reply).toContain('Email');
    expect(reply).toContain('哪一列能唯一认出一条记录');
  }, 20000);
});
