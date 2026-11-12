import { describe, expect, it } from 'vitest';
import {
  createWorkspaceStore,
  type ReasoningSession,
} from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

function setup() {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  return { store, app: createApiApp(store) };
}

async function ask(
  app: ReturnType<typeof createApiApp>,
  body: { question: string; mode: ReasoningSession['mode']; projectId?: string },
) {
  const res = await app.request('/api/analytics/reasoning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { session: ReasoningSession }).session;
}

/** Every percentage or count the session presents as a finding. */
const statedFigures = (session: ReasoningSession): string =>
  [
    ...session.dataSummary.map((d) => `${d.value} ${d.delta ?? ''}`),
    ...session.causalAnalysis,
    ...session.policyRecommendations.map((p) => p.expectedImpact),
    session.answerMarkdown,
  ].join('\n');

describe('Data Ontology Reasoning endpoint: grounded on the suite', () => {
  it('answers from an M7 reference query and reports only figures read off its rows', async () => {
    const { app, store } = setup();
    const report = store.getProject('proj-contract')!.suite.M7!.query_reports[0]!;

    const session = await ask(app, {
      question: `查看${report.alias}`,
      mode: 'ASK_DATA',
      projectId: 'proj-contract',
    });

    expect(session.grounding?.referenceQueryId).toBe(report.id);
    expect(session.grounding?.missingModels).toEqual([]);
    expect(session.grounding?.tables.length).toBeGreaterThan(0);
    expect(session.queryRows?.length).toBeGreaterThan(0);

    // The row count shown is the row count returned.
    expect(session.dataSummary[0]!.value).toContain(String(session.queryRows!.length));
    // Any sum shown is the sum of that column in the returned rows.
    for (const item of session.dataSummary.slice(1)) {
      const column = session.queryColumns!.find((c) => item.label.includes(c))!;
      const total = session.queryRows!.reduce((sum, row) => sum + Number(row[column] ?? 0), 0);
      expect(Number(item.value)).toBeCloseTo(total, 2);
    }
    expect(statedFigures(session)).not.toMatch(/\d+(\.\d+)?%/);
  });

  it('queries only tables the grounding knows', async () => {
    const { app } = setup();
    const session = await ask(app, {
      question: 'workspace_entities 里有多少条记录',
      mode: 'ASK_DATA',
      projectId: 'proj-contract',
    });
    expect(session.sqlGenerated).not.toContain('workspace_entities');
    expect(session.grounding?.tables).not.toContain('workspace_entities');
  });

  it('names the missing models and states no figures when the project cannot ground a query', async () => {
    const { app, store } = setup();
    const empty = store.createProject({
      name: '空白工程',
      code: 'EMPTY_REASONING',
      domain: '测试',
      template: 'EMPTY',
    });

    const session = await ask(app, {
      question: '分析高风险单据逾期率上升的原因',
      mode: 'ASK_WHY',
      projectId: empty.id,
    });

    expect(session.grounding?.missingModels).toEqual(['MM', 'M7']);
    expect(session.sqlGenerated).toBe('');
    expect(session.queryRows).toBeUndefined();
    expect(session.dataSummary).toEqual([]);
    expect(session.causalAnalysis.join('\n')).toMatch(/MM/);
    expect(session.causalAnalysis.join('\n')).toMatch(/M7/);
    expect(session.answerMarkdown).toMatch(/MM/);
    // No rate, share, or count is invented to fill the gap.
    expect(statedFigures(session)).not.toMatch(/\d+(\.\d+)?%/);
    expect(statedFigures(session)).not.toMatch(/\d{2,}/);
  });
});
