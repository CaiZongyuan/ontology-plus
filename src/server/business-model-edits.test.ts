import { describe, expect, it } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../packages/business-vocabulary/index.js';
import {
  projectByBusinessObject,
  type OntologySuite,
} from '../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type ProjectDetail,
  type SuiteCommitEvent,
} from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

function createObservedApp() {
  const commits: SuiteCommitEvent[] = [];
  const store = createWorkspaceStore({
    dbPath: ':memory:',
    enableFileMirror: false,
    onSuiteCommit: (event) => commits.push(event),
  });
  const api = createApiApp(store);
  return { store, api, commits };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function assertCleanPlainBusinessCopy(text: string, label: string) {
  expect(text.trim().length, `${label} should be non-empty`).toBeGreaterThan(0);
  const violations = checkBusinessViewMarkup(text, { plainText: true });
  expect(
    violations,
    `${label}\n${formatBusinessViewViolations(violations)}`,
  ).toEqual([]);
}

describe('PATCH /api/projects/:id/business-model (Business View direct edits, #69)', () => {
  it('persists valid inline rename & description edits across Business Objects, Fields, Actions, Cross-Object Rules, Flows, Roles, and Reports via commitSuite (MANUAL)', async () => {
    const { store, api, commits } = createObservedApp();

    // 1. Business Object rename & description
    const objRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'BUSINESS_OBJECT',
          objectId: 'AGG-01',
          name: '商务合同',
          description: '承载企业商务合同从起草、会签到结算归档的核心信息。',
        },
      }),
    );
    expect(objRes.status).toBe(200);
    const objBody = (await objRes.json()) as { project: ProjectDetail };
    expect(objBody.project.validation.errorCount).toBe(0);
    expect(
      objBody.project.suite.M1?.aggregates.find((a) => a.id === 'AGG-01')?.alias,
    ).toBe('商务合同');
    expect(
      objBody.project.suite.M1?.aggregates.find((a) => a.id === 'AGG-01')?.description,
    ).toBe('承载企业商务合同从起草、会签到结算归档的核心信息。');
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      projectId: 'proj-contract',
      source: { kind: 'MANUAL', modelCode: 'M1' },
    });

    // 2. Field label & description
    const fieldRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'FIELD',
          objectId: 'AGG-01',
          fieldName: 'title',
          name: '商务合同标题',
          description: '展示在合同台账和审批单顶部的正式名称',
        },
      }),
    );
    expect(fieldRes.status).toBe(200);

    // 3. Action name & description
    const actRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'ACTION',
          actionId: 'BHV-01',
          name: '起草商务合同',
          description: '由合同专员发起新的合同草稿并核验相对方准入状态。',
        },
      }),
    );
    expect(actRes.status).toBe(200);
    expect(commits.at(-1)).toMatchObject({
      source: { kind: 'MANUAL', modelCode: 'M2' },
    });

    // 4. Cross-object M3 rule edited ONCE (User Story 28) -> reflected on every related Business Object page
    const ruleRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'M3_RULE',
          ruleId: 'RULE-03',
          name: '累计结算不超合同总额规则',
          description: '同一份合同下的全部履约结算单金额合计不得超过合同总额。',
        },
      }),
    );
    expect(ruleRes.status).toBe(200);
    const ruleBody = (await ruleRes.json()) as { project: ProjectDetail };
    const projected = projectByBusinessObject(ruleBody.project.suite);
    const ruleOnContract = projected.objects
      .find((o) => o.id === 'AGG-01')!
      .businessRules.find((r) => r.id === 'RULE-03');
    const ruleOnSettlement = projected.objects
      .find((o) => o.id === 'AGG-03')!
      .businessRules.find((r) => r.id === 'RULE-03');
    expect(ruleOnContract?.displayName).toBe('累计结算不超合同总额规则');
    expect(ruleOnContract?.description).toBe(
      '同一份合同下的全部履约结算单金额合计不得超过合同总额。',
    );
    // Exact same projected rule on both related Business Objects
    expect(ruleOnSettlement).toBe(ruleOnContract);

    // 5. Cross-Object views: Flow (M6), Role (M5), and Query/Report (M7)
    const flowRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'FLOW',
          flowId: 'FLW-01',
          name: '商务合同分级审批主流程',
          description: '覆盖合同起草、风险定级与多级会签放行。',
        },
      }),
    );
    expect(flowRes.status).toBe(200);

    const roleRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'ROLE',
          roleId: 'ROLE-CONTRACT-SPEC',
          name: '商务合同专员',
          description: '负责合同起草、条款修订与发起会签。',
        },
      }),
    );
    expect(roleRes.status).toBe(200);

    const reportRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'QUERY_REPORT',
          reportId: 'QRY-01',
          name: '商务合同台账查询',
          description: '按条件筛选并查看合同与累计结算进度。',
        },
      }),
    );
    expect(reportRes.status).toBe(200);

    expect(commits).toHaveLength(7);
    expect(store.getProject('proj-contract')!.validation.errorCount).toBe(0);
  });

  it('rejects edits introducing new Consistency Errors with HTTP 422, leaves stored suite untouched, and returns clean business-language reasons + assistant prompts', async () => {
    const { store, api, commits } = createObservedApp();
    const baseline = store.getProject('proj-contract')!;

    // Case A: Duplicate Business Object name (renaming "签约相对方" -> "合同")
    const dupObjRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'BUSINESS_OBJECT',
          objectId: 'AGG-02',
          name: '合同',
        },
      }),
    );
    expect(dupObjRes.status).toBe(422);
    const dupObjBody = (await dupObjRes.json()) as {
      code: string;
      reasonZh: string;
      reasonEn: string;
      assistantPromptZh: string;
      assistantPromptEn: string;
      newErrorCount: number;
    };
    expect(dupObjBody.code).toBe('SUITE_VALIDATION_REJECTED');
    expect(dupObjBody.newErrorCount).toBeGreaterThan(0);
    expect(dupObjBody.reasonZh).toContain('需要修正的问题');
    expect(dupObjBody.reasonEn.toLowerCase()).toContain('problems to fix');
    assertCleanPlainBusinessCopy(dupObjBody.reasonZh, 'dupObj reasonZh');
    assertCleanPlainBusinessCopy(dupObjBody.reasonEn, 'dupObj reasonEn');
    assertCleanPlainBusinessCopy(dupObjBody.assistantPromptZh, 'dupObj assistantPromptZh');
    assertCleanPlainBusinessCopy(dupObjBody.assistantPromptEn, 'dupObj assistantPromptEn');
    expect(dupObjBody.assistantPromptZh).toContain('签约相对方');
    expect(dupObjBody.assistantPromptZh).toContain('合同');

    // Case B: Duplicate Field label on the same Business Object ("合同名称" -> "合同编号")
    const dupFieldRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'FIELD',
          objectId: 'AGG-01',
          fieldName: 'title',
          name: '合同编号',
        },
      }),
    );
    expect(dupFieldRes.status).toBe(422);
    const dupFieldBody = (await dupFieldRes.json()) as typeof dupObjBody;
    assertCleanPlainBusinessCopy(dupFieldBody.reasonZh, 'dupField reasonZh');
    assertCleanPlainBusinessCopy(dupFieldBody.reasonEn, 'dupField reasonEn');

    // Case C: Empty name
    const emptyRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        edit: {
          kind: 'ACTION',
          actionId: 'BHV-01',
          name: '   ',
        },
      }),
    );
    expect(emptyRes.status).toBe(422);
    const emptyBody = (await emptyRes.json()) as typeof dupObjBody;
    assertCleanPlainBusinessCopy(emptyBody.reasonZh, 'empty reasonZh');
    assertCleanPlainBusinessCopy(emptyBody.reasonEn, 'empty reasonEn');

    // Case D: Uncascaded cross-reference break across M1/M2/M3/MU/MM (via suite candidate)
    const brokenRefSuite: OntologySuite = JSON.parse(JSON.stringify(baseline.suite));
    brokenRefSuite.M1!.aggregates[0]!.name = 'CommercialAgreement';
    const brokenRefRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', {
        suite: brokenRefSuite,
        intentSummary: {
          targetLabelZh: '合同',
          targetLabelEn: 'Contract',
          desiredChangeZh: '将业务对象改为「商务协议」并同步关联项',
          desiredChangeEn: 'rename Contract to "Commercial Agreement" across linked items',
        },
      }),
    );
    expect(brokenRefRes.status).toBe(422);
    const brokenRefBody = (await brokenRefRes.json()) as typeof dupObjBody;
    expect(brokenRefBody.newErrorCount).toBeGreaterThan(1);
    assertCleanPlainBusinessCopy(brokenRefBody.reasonZh, 'brokenRef reasonZh');
    assertCleanPlainBusinessCopy(brokenRefBody.reasonEn, 'brokenRef reasonEn');
    assertCleanPlainBusinessCopy(
      brokenRefBody.assistantPromptZh,
      'brokenRef assistantPromptZh',
    );
    assertCleanPlainBusinessCopy(
      brokenRefBody.assistantPromptEn,
      'brokenRef assistantPromptEn',
    );

    // Stored suite and commit count are completely untouched across all 4 rejected edits
    expect(commits).toHaveLength(0);
    expect(store.getProject('proj-contract')!.suite).toEqual(baseline.suite);
  });

  it('preserves Technical Details PUT /api/projects/:id/suite semantics so experts can still save suites with Consistency Errors (200)', async () => {
    const { store, api, commits } = createObservedApp();
    const baseline = store.getProject('proj-contract')!;

    const expertSuiteWithErrors: OntologySuite = JSON.parse(JSON.stringify(baseline.suite));
    expertSuiteWithErrors.M1!.aggregates[0]!.name = 'ExpertRenamedWithoutCascade';

    // Business View endpoint rejects it with 422
    const bizRes = await api.request(
      '/api/projects/proj-contract/business-model',
      jsonInit('PATCH', { suite: expertSuiteWithErrors }),
    );
    expect(bizRes.status).toBe(422);
    expect(commits).toHaveLength(0);

    // Technical Details PUT /suite endpoint saves the exact same suite with 200
    const techRes = await api.request(
      '/api/projects/proj-contract/suite',
      jsonInit('PUT', {
        suite: expertSuiteWithErrors,
        changelogNote: 'Expert progressive edit in Technical Details',
      }),
    );
    expect(techRes.status).toBe(200);
    const techBody = (await techRes.json()) as { project: ProjectDetail };
    expect(techBody.project.validation.errorCount).toBeGreaterThan(0);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      projectId: 'proj-contract',
      source: { kind: 'MANUAL' },
      note: 'Expert progressive edit in Technical Details',
    });
  });
});
