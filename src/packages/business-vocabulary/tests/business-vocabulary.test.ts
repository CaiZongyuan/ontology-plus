import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODEL_CODES } from '../../ontology-core/index.js';
import {
  BUSINESS_VOCABULARY,
  MODEL_BUSINESS_NAMES,
  PROJECT_STEP_IDS,
  PROJECT_STEP_NAMES,
  PROJECT_STEP_STATE_IDS,
  PROJECT_STEP_STATE_NAMES,
  getModelBusinessName,
  pickBusinessText,
} from '../index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const glossaryPath = path.join(repoRoot, 'GLOSSARY.md');

interface ParsedGlossaryEntry {
  termEn: string;
  termZh: string;
  modelCode?: string;
  shownAs?: { zh: string; en: string };
}

function parseGlossary(markdown: string): ParsedGlossaryEntry[] {
  const blocks = markdown.split(/\n{2,}/);
  const entries: ParsedGlossaryEntry[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    const headerMatch = /^\*\*([^*(\n]+?)\s*\(([^)]+)\)\*\*:\s*\n/m.exec(trimmed);
    if (!headerMatch) continue;

    const termEn = headerMatch[1]!.trim();
    const rawParen = headerMatch[2]!.trim();
    const codeMatch = /^`([A-Z0-9]+)`\s+(.+)$/.exec(rawParen);
    const modelCode = codeMatch?.[1];
    const termZh = (codeMatch ? codeMatch[2]! : rawParen).trim();

    const shownAsMatch = /^_Shown to business users as_:\s*(.+?)\s*\(([^)]+)\)\s*$/m.exec(trimmed);
    entries.push({
      termEn,
      termZh,
      ...(modelCode ? { modelCode } : {}),
      ...(shownAsMatch
        ? {
            shownAs: {
              zh: shownAsMatch[1]!.trim(),
              en: shownAsMatch[2]!.trim(),
            },
          }
        : {}),
    });
  }

  return entries;
}

describe('business vocabulary & GLOSSARY.md alignment', () => {
  it('maps every Spec #37 Section 7 model code and workspace concept 1-to-1 in Chinese and English', () => {
    expect(Object.keys(MODEL_BUSINESS_NAMES)).toEqual([...MODEL_CODES]);

    expect(MODEL_BUSINESS_NAMES.M1).toMatchObject({
      modelCode: 'M1',
      zh: '业务对象',
      en: 'Business Objects',
      singularZh: '业务对象',
      singularEn: 'Business Object',
    });
    expect(MODEL_BUSINESS_NAMES.M2).toMatchObject({
      modelCode: 'M2',
      zh: '业务操作',
      en: 'Actions',
      singularZh: '业务操作',
      singularEn: 'Action',
    });
    expect(MODEL_BUSINESS_NAMES.M3).toMatchObject({
      modelCode: 'M3',
      zh: '业务规则',
      en: 'Business Rules',
      singularZh: '业务规则',
      singularEn: 'Business Rule',
    });
    expect(MODEL_BUSINESS_NAMES.ME).toMatchObject({
      modelCode: 'ME',
      zh: '业务事件',
      en: 'Business Events',
      singularZh: '业务事件',
      singularEn: 'Business Event',
    });
    expect(MODEL_BUSINESS_NAMES.M4).toMatchObject({
      modelCode: 'M4',
      zh: '自动联动',
      en: 'Automations',
      singularZh: '自动联动',
      singularEn: 'Automation',
    });
    expect(MODEL_BUSINESS_NAMES.M5).toMatchObject({
      modelCode: 'M5',
      zh: '角色与权限',
      en: 'Roles & Permissions',
      singularZh: '角色与权限',
      singularEn: 'Role & Permission',
    });
    expect(MODEL_BUSINESS_NAMES.M6).toMatchObject({
      modelCode: 'M6',
      zh: '流程与审批',
      en: 'Flows & Approvals',
      singularZh: '流程与审批',
      singularEn: 'Flow',
    });
    expect(MODEL_BUSINESS_NAMES.M7).toMatchObject({
      modelCode: 'M7',
      zh: '查询与报表',
      en: 'Queries & Reports',
      singularZh: '查询与报表',
      singularEn: 'Query / Report',
    });
    expect(MODEL_BUSINESS_NAMES.MU).toMatchObject({
      modelCode: 'MU',
      zh: '界面',
      en: 'Screens',
      singularZh: '界面',
      singularEn: 'Screen',
    });
    expect(MODEL_BUSINESS_NAMES.MM).toMatchObject({
      modelCode: 'MM',
      zh: '数据存储',
      en: 'Data Storage',
      singularZh: '数据存储',
      singularEn: 'Data Storage',
    });
    expect(MODEL_BUSINESS_NAMES.MI).toMatchObject({
      modelCode: 'MI',
      zh: '对外接口',
      en: 'Integrations',
      singularZh: '对外接口',
      singularEn: 'Integration',
    });

    expect(BUSINESS_VOCABULARY.ONTOLOGY_PROJECT).toMatchObject({
      zh: '项目',
      en: 'Project',
    });
    expect(BUSINESS_VOCABULARY.ONTOLOGY_SUITE).toMatchObject({
      zh: '业务模型',
      en: 'Business Model',
    });
    expect(BUSINESS_VOCABULARY.CONSISTENCY_ERROR).toMatchObject({
      zh: '需要修正的问题',
      en: 'Problems to fix',
    });
    expect(BUSINESS_VOCABULARY.STAGE_WARNING).toMatchObject({
      zh: '尚未完成的部分',
      en: 'Not yet completed',
    });
    expect(BUSINESS_VOCABULARY.CONFIRMED_REVISION).toMatchObject({
      zh: '已确认的原型',
      en: 'Confirmed prototype',
    });
    expect(BUSINESS_VOCABULARY.AI_ASSISTANT).toMatchObject({
      zh: 'AI 助手',
      en: 'AI Assistant',
    });

    expect(getModelBusinessName('M1', 'zh-CN')).toBe('业务对象');
    expect(getModelBusinessName('M1', 'en-US')).toBe('Business Objects');
    expect(pickBusinessText(BUSINESS_VOCABULARY.AI_ASSISTANT, 'zh-CN')).toBe('AI 助手');
    expect(pickBusinessText(BUSINESS_VOCABULARY.AI_ASSISTANT, 'en-US')).toBe('AI Assistant');
  });

  it('covers the 4 Project Steps, 5 Step States, and lifecycle collaboration concepts', () => {
    expect(PROJECT_STEP_IDS).toEqual([
      'REQUIREMENTS',
      'PROTOTYPE',
      'BUSINESS_MODEL',
      'DELIVERY',
    ]);
    expect(PROJECT_STEP_NAMES).toEqual({
      REQUIREMENTS: { zh: '需求', en: 'Requirements' },
      PROTOTYPE: { zh: '原型', en: 'Prototype' },
      BUSINESS_MODEL: { zh: '业务模型', en: 'Business Model' },
      DELIVERY: { zh: '交付', en: 'Delivery' },
    });

    expect(PROJECT_STEP_STATE_IDS).toEqual([
      'NOT_STARTED',
      'IN_PROGRESS',
      'UNCONFIRMED_CHANGES',
      'CONFIRMED',
      'OUTDATED',
    ]);
    expect(PROJECT_STEP_STATE_NAMES).toEqual({
      NOT_STARTED: { zh: '未开始', en: 'Not started' },
      IN_PROGRESS: { zh: '进行中', en: 'In progress' },
      UNCONFIRMED_CHANGES: { zh: '有未确认的修改', en: 'Unconfirmed changes' },
      CONFIRMED: { zh: '已确认', en: 'Confirmed' },
      OUTDATED: { zh: '待更新', en: 'Outdated' },
    });

    expect(BUSINESS_VOCABULARY.PROJECT_STEP).toMatchObject({ zh: '步骤', en: 'Project Step' });
    expect(BUSINESS_VOCABULARY.STEP_HANDOFF).toMatchObject({ zh: '步骤转交', en: 'Step Hand-off' });
    expect(BUSINESS_VOCABULARY.STEP_CONFIRMATION).toMatchObject({
      zh: '步骤确认',
      en: 'Step Confirmation',
    });
    expect(BUSINESS_VOCABULARY.OUTDATED).toMatchObject({ zh: '待更新', en: 'Outdated' });
    expect(BUSINESS_VOCABULARY.CHANGE_SUMMARY).toMatchObject({
      zh: '变更说明',
      en: 'Change Summary',
    });
    expect(BUSINESS_VOCABULARY.BUSINESS_VIEW).toMatchObject({
      zh: '业务视图',
      en: 'Business View',
    });
    expect(BUSINESS_VOCABULARY.TECHNICAL_DETAILS).toMatchObject({
      zh: '技术细节',
      en: 'Technical Details',
    });
  });

  it('stays bidirectionally 1-to-1 consistent with every Shown-to-business-users-as and direct business term in GLOSSARY.md', () => {
    const glossary = parseGlossary(fs.readFileSync(glossaryPath, 'utf8'));
    const shownAsFromGlossary = glossary.filter((item) => item.shownAs !== undefined);
    expect(shownAsFromGlossary.length).toBe(18);
    expect(BUSINESS_VOCABULARY.ONTOLOGY_SYNTHESIS).toMatchObject({
      zh: '生成业务模型',
      en: 'Generate business model',
    });

    const vocabShownAs = Object.values(BUSINESS_VOCABULARY).filter((entry) => entry.shownAsInGlossary);

    // Exact 1-to-1 count and bidirectional membership
    expect(vocabShownAs.map((e) => e.glossaryTermEn).sort()).toEqual(
      shownAsFromGlossary.map((g) => g.termEn).sort(),
    );

    for (const g of shownAsFromGlossary) {
      const match = vocabShownAs.find((e) => e.glossaryTermEn === g.termEn);
      expect(match, `Missing vocabulary entry for GLOSSARY term "${g.termEn}"`).toBeDefined();
      expect(match!.glossaryTermZh).toBe(g.termZh);
      expect(match!.zh).toBe(g.shownAs!.zh);
      expect(match!.en).toBe(g.shownAs!.en);
      if (g.modelCode) {
        expect(match!.key).toBe(g.modelCode);
      }
    }

    // No two canonical Shown-as terms collapse to the same Chinese or English business name
    expect(new Set(vocabShownAs.map((e) => e.zh)).size).toBe(vocabShownAs.length);
    expect(new Set(vocabShownAs.map((e) => e.en)).size).toBe(vocabShownAs.length);

    // Direct user-facing concepts defined in GLOSSARY.md without a separate Shown-as alias also match
    const directEntries = Object.values(BUSINESS_VOCABULARY).filter((e) => !e.shownAsInGlossary);
    for (const entry of directEntries) {
      const g = glossary.find((item) => item.termEn === entry.glossaryTermEn);
      expect(g, `Missing GLOSSARY heading for "${entry.glossaryTermEn}"`).toBeDefined();
      expect(g!.shownAs).toBeUndefined();
      expect(entry.zh).toBe(g!.termZh);
      expect(entry.en).toBe(g!.termEn);
    }
  });
});
