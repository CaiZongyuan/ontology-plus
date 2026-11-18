import { describe, expect, it } from 'vitest';
import {
  DOMAIN_RUN_TOOL_NAMES,
  ONTOLOGY_TOOL_NAMES,
  PROTOTYPE_ANCHOR_TOOL_NAMES,
  UNIFIED_AGENT_EXTRA_TOOLS,
} from '../../agent-runtime/index.js';
import {
  MODEL_BUSINESS_NAMES,
  TOOL_PROGRESS_CATALOG,
  checkBusinessViewMarkup,
  formatToolProgress,
  formatToolProgressLine,
  formatToolStepLabel,
  resolveToolProgressSpec,
} from '../index.js';

describe('tool-call to business-language progress mapping', () => {
  it('covers every registered agent-runtime tool and derives ontology tool names from MODEL_BUSINESS_NAMES', () => {
    const allRuntimeToolNames = new Set<string>([
      ...ONTOLOGY_TOOL_NAMES,
      ...PROTOTYPE_ANCHOR_TOOL_NAMES,
      ...DOMAIN_RUN_TOOL_NAMES,
      ...UNIFIED_AGENT_EXTRA_TOOLS.map((t) => t.function.name),
    ]);

    for (const toolName of allRuntimeToolNames) {
      expect(
        TOOL_PROGRESS_CATALOG[toolName],
        `Register agent tool "${toolName}" in TOOL_PROGRESS_CATALOG`,
      ).toBeDefined();
    }

    // Verify 11 upsert_* tools derive directly from MODEL_BUSINESS_NAMES
    const expectedModelMap = {
      upsert_aggregate: 'M1',
      upsert_behavior: 'M2',
      upsert_rule: 'M3',
      upsert_event: 'ME',
      upsert_scenario: 'M4',
      upsert_actor_role: 'M5',
      upsert_flow: 'M6',
      upsert_query_report: 'M7',
      upsert_screen: 'MU',
      upsert_mapping: 'MM',
      upsert_interface: 'MI',
    } as const;

    for (const [toolName, code] of Object.entries(expectedModelMap)) {
      const spec = resolveToolProgressSpec(toolName);
      const modelTerm = MODEL_BUSINESS_NAMES[code];
      expect(spec.modelCode).toBe(code);
      expect(spec.label.zh).toContain(modelTerm.zh);
      expect(spec.label.en).toContain(modelTerm.en);
      expect(spec.activeLabel.zh).toContain(modelTerm.zh);
      expect(spec.activeLabel.en).toContain(modelTerm.en);
    }
  });

  it('interpolates clean business object names deterministically in zh-CN and en-US while stripping technical IDs and model codes', () => {
    expect(
      formatToolProgressLine(
        'upsert_aggregate',
        { id: 'AGG-01', name: 'Contract', alias: '合同' },
        'zh-CN',
      ),
    ).toBe('正在更新业务对象「合同」');

    expect(
      formatToolProgressLine(
        'upsert_aggregate',
        { id: 'AGG-01', name: 'Contract', alias: '合同' },
        'en-US',
      ),
    ).toBe("Updating Business Object 'Contract'");

    expect(formatToolProgressLine('upsert_aggregate', { alias: 'Contract' }, 'en-US')).toBe(
      "Updating Business Object 'Contract'",
    );

    expect(
      formatToolStepLabel('upsert_behavior', {
        id: 'BHV-02',
        name: 'submitForApproval',
        alias: '提交审批',
      }),
    ).toEqual({
      zh: '更新业务操作「提交审批」',
      en: "Update Action 'submitForApproval'",
    });

    // Translates modelCode to business name and never leaks RULE-01 or t_contract
    expect(
      formatToolProgress('delete_element', { modelCode: 'M3', elementId: 'RULE-01' }),
    ).toEqual({
      zh: '正在移除业务规则',
      en: 'Removing Business Rule',
    });

    expect(formatToolProgress('inspect_ontology_model', { modelCode: 'M5' })).toEqual({
      zh: '正在检查角色与权限',
      en: 'Checking Roles & Permissions',
    });

    expect(formatToolProgress('inspect_ontology_model', { modelCode: 'ALL' })).toEqual({
      zh: '正在检查业务模型',
      en: 'Checking Business Model',
    });

    expect(
      formatToolProgress('upsert_mapping', {
        id: 'MAP-01',
        tableName: 't_contract',
        alias: '合同',
        objectName: 'Contract',
      }),
    ).toEqual({
      zh: '正在更新数据存储「合同」',
      en: "Updating Data Storage 'Contract'",
    });
  });

  it('produces zero Business View vocabulary violations across all catalogued and unknown tools', () => {
    const sampleCalls: Array<{ toolName: string; args?: Record<string, unknown> }> = [
      ...Object.keys(TOOL_PROGRESS_CATALOG).map((toolName) => ({ toolName })),
      { toolName: 'upsert_aggregate', args: { id: 'AGG-01', alias: '合同', name: 'Contract' } },
      { toolName: 'delete_element', args: { modelCode: 'M1', elementId: 'AGG-01' } },
      { toolName: 'inspect_ontology_model', args: { modelCode: 'MI' } },
      {
        toolName: 'edit_prototype_anchor',
        args: { screenId: 'SCR-CONTRACT-LIST', elementId: 'EL-ACT-NEW', label: '新建合同按钮' },
      },
      {
        toolName: 'save_synthesized_srs_doc',
        args: { title: '合同管理 — SRS.md' },
      },
      { toolName: 'mcp_query_contracts', args: { riskLevel: 'HIGH' } },
      { toolName: 'unknown_custom_sql_tool', args: { sql: 'SELECT * FROM t_contract' } },
    ];

    for (const { toolName, args } of sampleCalls) {
      const step = formatToolStepLabel(toolName, args);
      const progress = formatToolProgress(toolName, args);
      for (const text of [step.zh, step.en, progress.zh, progress.en]) {
        expect(
          checkBusinessViewMarkup(`<span>${text}</span>`),
          `Tool "${toolName}" leaked jargon in "${text}"`,
        ).toEqual([]);
      }
    }
  });
});
