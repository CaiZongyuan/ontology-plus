import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../i18n.js';
import {
  buildDesignBriefFromState,
  compileDesignBriefGenerationPrompt,
} from './DesignBriefAndStyleTile.js';
import {
  CURATED_INSPO_CATALOG,
  PrototypeCoDesignStudio,
} from './PrototypeCoDesignStudio.js';
import { createInitialVisualReferenceSelection } from './VisualReferencePicker.js';
import {
  DEFAULT_ALIGNMENT_STATE,
  InteractiveMiniStage,
  MOTION_SCHEMATICS_BY_ID,
  MOTION_SCHEMATIC_GROUPS,
  MotionSchematicGallery,
  StyleTileMotionSampleStrip,
  extractDomainNounsFromSrs,
  formatMotionSpecsForAgentPrompt,
  inferDefaultMotionSelectionFromSrs,
  resolveMotionSelection,
  syncAlignmentWithSelection,
  triggerMotionSchematic,
  type MotionPaletteTokens,
  type MotionSchematicGroupKey,
  type MotionSchematicId,
  type MotionStageStepMap,
} from './MotionSchematicGallery.js';

const EXPECTED_GROUP_KEYS: MotionSchematicGroupKey[] = [
  'detailOpen',
  'informationDensity',
  'navigationStructure',
  'tableRowActions',
  'formValidationSave',
  'emptyAndLoading',
  'approvalAndFeedback',
];

describe('Motion Schematic 7-group catalog & MotionSpec contracts', () => {
  it('defines all 7 required groups with 2 to 4 schematics per group and complete MotionSpec on each option', () => {
    expect(MOTION_SCHEMATIC_GROUPS.map((g) => g.key)).toEqual(EXPECTED_GROUP_KEYS);

    const seenIds = new Set<string>();

    for (const group of MOTION_SCHEMATIC_GROUPS) {
      expect(group.title.zh.length).toBeGreaterThan(0);
      expect(group.title.en.length).toBeGreaterThan(0);
      expect(group.options.length).toBeGreaterThanOrEqual(2);
      expect(group.options.length).toBeLessThanOrEqual(4);

      for (const option of group.options) {
        expect(seenIds.has(option.id)).toBe(false);
        seenIds.add(option.id);
        expect(option.groupKey).toBe(group.key);
        expect(option.plainTitle.zh.length).toBeGreaterThan(0);
        expect(option.plainTitle.en.length).toBeGreaterThan(0);
        expect(option.plainDesc.zh.length).toBeGreaterThan(0);
        expect(option.plainDesc.en.length).toBeGreaterThan(0);

        const spec = option.motionSpec;
        expect(spec.trigger.zh.length).toBeGreaterThan(0);
        expect(spec.trigger.en.length).toBeGreaterThan(0);
        expect(spec.target.zh.length).toBeGreaterThan(0);
        expect(spec.target.en.length).toBeGreaterThan(0);
        expect(spec.durationMs).toBeGreaterThanOrEqual(120);
        expect(spec.durationMs).toBeLessThanOrEqual(600);
        expect(spec.easing).toMatch(/cubic-bezier|ease|linear/);
        expect(spec.reducedMotionFallback.zh).toContain('0ms');
        expect(spec.reducedMotionFallback.en).toContain('0ms');
        expect(spec.exampleCode.trim().length).toBeGreaterThan(20);
      }
    }
  });
});

describe('SRS domain noun extraction & automatic 7-group pre-selection', () => {
  it('extracts business nouns from SRS markdown or M1 aggregates and falls back cleanly when empty', () => {
    const fromSrs = extractDomainNounsFromSrs(
      '## 1. 业务范围\n本系统管理**采购合同**（Purchase Contract）签订与**付款里程碑**（Payment Milestone）验收付款。',
    );
    expect(fromSrs.primaryEntity).toEqual({ zh: '采购合同', en: 'Purchase Contract' });
    expect(fromSrs.secondaryEntity).toEqual({ zh: '付款里程碑', en: 'Payment Milestone' });
    expect(fromSrs.createAction).toEqual({ zh: '新建采购合同', en: 'New Purchase Contract' });
    expect(fromSrs.approveAction.zh).toContain('采购合同');
    expect(fromSrs.approveAction.en).toContain('Purchase Contract');

    const fromProjectOnly = extractDomainNounsFromSrs('', {
      name: '冷链物流运单中心',
      domain: 'logistics',
      suite: {
        M1: {
          model_type: 'OBJECT',
          domain: 'logistics',
          version: '5.0',
          data_dictionaries: [],
          aggregate_associations: [],
          aggregates: [
            {
              id: 'AGG-WAYBILL',
              name: 'ColdChainWaybill',
              alias: '冷链运单',
              aggregateType: 'AGGREGATE_ROOT',
              description: '温控运输主单',
              lifecycle: ['DRAFT', 'ACTIVE'],
              tags: [],
              attributes: [],
              entities: [
                {
                  localId: 'ENT-TEMP',
                  name: 'TempCheckpoint',
                  alias: '温控节点',
                  cardinality: 'ONE_OR_MORE',
                  cascadeDelete: true,
                  attributes: [],
                },
              ],
              valueObjects: [],
              invariants: [],
            },
          ],
        },
      },
    });
    expect(fromProjectOnly.primaryEntity.zh).toBe('冷链运单');
    expect(fromProjectOnly.primaryEntity.en).toBe('Cold Chain Waybill');
    expect(fromProjectOnly.secondaryEntity.zh).toBe('温控节点');

    const fallback = extractDomainNounsFromSrs('');
    expect(fallback.primaryEntity).toEqual({ zh: '业务单据', en: 'Business Record' });
    expect(fallback.secondaryEntity).toEqual({ zh: '执行明细', en: 'Line Item' });
  });

  it('pre-selects valid defaults across all 7 groups from SRS signals without user action', () => {
    const emptySelection = inferDefaultMotionSelectionFromSrs('');
    for (const group of MOTION_SCHEMATIC_GROUPS) {
      const pickedId = emptySelection[group.key];
      expect(MOTION_SCHEMATICS_BY_ID[pickedId]?.groupKey).toBe(group.key);
    }

    const enterpriseSrs = `
      # 集团多业务域采购结算平台
      1. 支持左右分栏同屏对照核对采购台账与高频财务对账明细；
      2. 支持勾选多条记录进行批量审批与批量导出；
      3. 复杂立项采用分步向导逐节预检；
      4. 提供多维筛选组合查询；
      5. 大额合同需业务主管与财务法务会签双人复核。
    `;
    const enterpriseSel = inferDefaultMotionSelectionFromSrs(enterpriseSrs);
    expect(enterpriseSel).toEqual({
      detailOpen: 'INLINE_SPLIT',
      informationDensity: 'COMPACT_LEDGER',
      navigationStructure: 'DUAL_RAIL_SWITCHER',
      tableRowActions: 'BATCH_FLOATING_BAR',
      formValidationSave: 'STEP_SECTION_PRECHECK',
      emptyAndLoading: 'FILTER_ZERO_RECOVERY',
      approvalAndFeedback: 'DUAL_SIGNOFF_PULSE',
    });

    const lightweightSrs = `
      # Creative Brand Asset Portal
      Lightweight portal with top bar navigation, bento card grid visual showcase,
      quick modal dialog creation, inline edit status cells, autosave draft editing,
      first-time onboarding empty guide, and chronological audit trail timeline.
    `;
    const lightweightSel = inferDefaultMotionSelectionFromSrs(lightweightSrs);
    expect(lightweightSel).toEqual({
      detailOpen: 'MODAL',
      informationDensity: 'MODULAR_CARDS',
      navigationStructure: 'TOP_SEGMENTED_HUB',
      tableRowActions: 'INLINE_QUICK_EDIT',
      formValidationSave: 'AUTOSAVE_DRAFT_BADGE',
      emptyAndLoading: 'GUIDED_EMPTY_CARD',
      approvalAndFeedback: 'INLINE_BANNER_TIMELINE',
    });

    // Backward-compatible resolution from legacy RequirementAlignmentState
    const resolvedFromLegacy = resolveMotionSelection({
      ...DEFAULT_ALIGNMENT_STATE,
      entryPattern: 'DEDICATED_TAB',
      layoutDensity: 'MODULAR_CARDS',
    });
    expect(resolvedFromLegacy.detailOpen).toBe('DEDICATED_TAB');
    expect(resolvedFromLegacy.informationDensity).toBe('MODULAR_CARDS');
  });
});

describe('formatMotionSpecsForAgentPrompt hard-constraint vs example formatting', () => {
  it('formats all 7 selected schematics with MUST SATISFY hard constraints and ADAPTIVE EXAMPLE code in zh-CN and en-US', () => {
    const selection = inferDefaultMotionSelectionFromSrs(
      '管理采购合同与批量审批、法务会签',
    );

    const zhPrompt = formatMotionSpecsForAgentPrompt(selection, 'zh-CN');
    expect(zhPrompt.match(/\[硬性约束 \/ MUST SATISFY\]/g)).toHaveLength(7);
    expect(zhPrompt.match(/\[示例代码（可按页面结构改写） \/ ADAPTIVE EXAMPLE\]/g)).toHaveLength(7);
    for (const group of MOTION_SCHEMATIC_GROUPS) {
      const chosen = MOTION_SCHEMATICS_BY_ID[selection[group.key]];
      expect(zhPrompt).toContain(group.title.zh);
      expect(zhPrompt).toContain(chosen.plainTitle.zh);
      expect(zhPrompt).toContain(chosen.motionSpec.trigger.zh);
      expect(zhPrompt).toContain(chosen.motionSpec.target.zh);
      expect(zhPrompt).toContain(`${chosen.motionSpec.durationMs}ms`);
      expect(zhPrompt).toContain(chosen.motionSpec.easing);
      expect(zhPrompt).toContain(chosen.motionSpec.reducedMotionFallback.zh);
      expect(zhPrompt).toContain(chosen.motionSpec.exampleCode.trim());
    }

    const enPrompt = formatMotionSpecsForAgentPrompt(selection, 'en-US');
    expect(enPrompt.match(/\[MUST SATISFY \/ 硬性约束\]/g)).toHaveLength(7);
    expect(enPrompt.match(/\[ADAPTIVE EXAMPLE \/ 示例代码（可按页面结构改写）\]/g)).toHaveLength(7);
    for (const group of MOTION_SCHEMATIC_GROUPS) {
      const chosen = MOTION_SCHEMATICS_BY_ID[selection[group.key]];
      expect(enPrompt).toContain(group.title.en);
      expect(enPrompt).toContain(chosen.plainTitle.en);
      expect(enPrompt).toContain(chosen.motionSpec.trigger.en);
      expect(enPrompt).toContain(chosen.motionSpec.target.en);
      expect(enPrompt).toContain(`${chosen.motionSpec.durationMs}ms`);
      expect(enPrompt).toContain(chosen.motionSpec.easing);
      expect(enPrompt).toContain(chosen.motionSpec.reducedMotionFallback.en);
      expect(enPrompt).toContain(chosen.motionSpec.exampleCode.trim());
    }
  });
});

function stubLocale(locale: 'zh-CN' | 'en-US') {
  const noop = () => {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

function findElementByTestId(
  node: React.ReactNode,
  testId: string,
): React.ReactElement<Record<string, unknown>> | null {
  if (!React.isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (props['data-testid'] === testId) {
    return node as React.ReactElement<Record<string, unknown>>;
  }
  const children = React.Children.toArray(props.children as React.ReactNode);
  for (const child of children) {
    const found = findElementByTestId(child, testId);
    if (found) return found;
  }
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Interactive click-triggered MotionSchematicGallery with palette & SRS nouns', () => {
  const customPalette: MotionPaletteTokens = {
    accentColor: '#d9480f',
    surfaceColor: '#fff9db',
    inkColor: '#212529',
    radiusPx: 14,
  };
  const srs =
    '## 核心业务\n围绕**采购合同**（Purchase Contract）与**付款里程碑**（Payment Milestone）进行履约台账管理与会签审批。';

  it('renders all 7 groups styled with Primary Reference palette and SRS domain nouns without nested buttons', () => {
    stubLocale('zh-CN');
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <MotionSchematicGallery palette={customPalette} srsMarkdown={srs} />
      </PreferencesProvider>,
    );

    for (const group of MOTION_SCHEMATIC_GROUPS) {
      expect(html).toContain(`data-testid="motion-group-${group.key}"`);
      expect(html).toContain(group.title.zh);
    }

    // Primary Reference palette tokens applied directly to rendered stages
    expect(html).toContain('#d9480f');
    expect(html).toContain('#fff9db');
    expect(html).toContain('#212529');
    expect(html).toContain('14px');

    // SRS domain nouns appear in live stage UI
    expect(html).toContain('采购合同');
    expect(html).toContain('新建采购合同');
    expect(html).toContain('付款里程碑');

    // Spec disclosures collapsed by default and zero illegal nested <button> tags
    expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
    expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
  });

  it('transitions live stage state when clicking interactive triggers in both zh-CN and en-US', () => {
    const nouns = extractDomainNounsFromSrs(srs);
    const representativeIds: MotionSchematicId[] = [
      'DRAWER',
      'COMPACT_LEDGER',
      'COLLAPSIBLE_RAIL',
      'BATCH_FLOATING_BAR',
      'REALTIME_STICKY_SAVE',
      'SKELETON_SHIMMER',
      'STEPPER_CORNER_TOAST',
    ];

    let stageSteps: MotionStageStepMap = {};

    for (const id of representativeIds) {
      // 1. Verify actual JSX button onClick invokes onTrigger
      let clickedCount = 0;
      const stageTree = InteractiveMiniStage({
        id,
        step: stageSteps[id] ?? 0,
        onTrigger: () => {
          clickedCount += 1;
          stageSteps = triggerMotionSchematic(stageSteps, id);
        },
        palette: customPalette,
        domainNouns: nouns,
        locale: 'zh-CN',
        reducedMotion: false,
      });

      const triggerBtn = findElementByTestId(stageTree, `motion-trigger-${id}`);
      expect(triggerBtn).not.toBeNull();
      const onClick = triggerBtn?.props.onClick as ((e: { stopPropagation: () => void }) => void) | undefined;
      expect(typeof onClick).toBe('function');

      const beforeZhHtml = renderToStaticMarkup(stageTree);
      expect(beforeZhHtml).toContain(`data-testid="motion-stage-${id}"`);
      expect(beforeZhHtml).toContain('data-stage-phase="idle"');

      // Simulate user click on the trigger control
      onClick!({ stopPropagation: () => {} });
      expect(clickedCount).toBe(1);

      const afterZhHtml = renderToStaticMarkup(
        InteractiveMiniStage({
          id,
          step: stageSteps[id] ?? 0,
          onTrigger: () => {},
          palette: customPalette,
          domainNouns: nouns,
          locale: 'zh-CN',
          reducedMotion: false,
        }),
      );
      expect(afterZhHtml).toContain('data-stage-phase="active"');
      expect(afterZhHtml).not.toBe(beforeZhHtml);
    }

    // Verify full gallery reflects triggered active stages in en-US as well
    stubLocale('en-US');
    const enGalleryHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <MotionSchematicGallery
          palette={customPalette}
          srsMarkdown={srs}
          stageSteps={stageSteps}
        />
      </PreferencesProvider>,
    );
    expect(enGalleryHtml).toContain('Purchase Contract');
    expect(enGalleryHtml).toContain('Payment Milestone');
    expect(enGalleryHtml.match(/data-stage-phase="active"/g)?.length).toBe(
      representativeIds.length,
    );

    // Ensure every single one of the 22 schematics across all 7 groups responds to click triggers
    for (const group of MOTION_SCHEMATIC_GROUPS) {
      for (const option of group.options) {
        const idleHtml = renderToStaticMarkup(
          InteractiveMiniStage({
            id: option.id,
            step: 0,
            onTrigger: () => {},
            palette: customPalette,
            domainNouns: nouns,
            locale: 'en-US',
            reducedMotion: false,
          }),
        );
        const activeHtml = renderToStaticMarkup(
          InteractiveMiniStage({
            id: option.id,
            step: 1,
            onTrigger: () => {},
            palette: customPalette,
            domainNouns: nouns,
            locale: 'en-US',
            reducedMotion: false,
          }),
        );
        expect(idleHtml).toContain('data-stage-phase="idle"');
        expect(activeHtml).toContain('data-stage-phase="active"');
        expect(activeHtml).not.toBe(idleHtml);
      }
    }
  });
});

describe('StyleTileMotionSampleStrip for Style Tile integration', () => {
  it('renders all 7 selected schematics as playable samples and supports optional group jump buttons', () => {
    stubLocale('zh-CN');
    const selection = inferDefaultMotionSelectionFromSrs(
      '围绕采购合同与付款里程碑进行财务台账批量审批与法务会签',
    );
    const nouns = extractDomainNounsFromSrs(
      '围绕**采购合同**（Purchase Contract）与**付款里程碑**（Payment Milestone）',
    );
    const palette: MotionPaletteTokens = {
      accentColor: '#0ca678',
      surfaceColor: '#f8f9fa',
      inkColor: '#18181b',
      radiusPx: 10,
    };

    let steps: MotionStageStepMap = {};
    const initialHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <StyleTileMotionSampleStrip
          selection={selection}
          palette={palette}
          domainNouns={nouns}
          stageSteps={steps}
          onSelectGroup={() => {}}
        />
      </PreferencesProvider>,
    );

    expect(initialHtml).toContain('data-testid="style-tile-motion-strip"');
    expect(initialHtml).toContain('#0ca678');
    expect(initialHtml).toContain('采购合同');

    for (const group of MOTION_SCHEMATIC_GROUPS) {
      const selectedId = selection[group.key];
      expect(initialHtml).toContain(`data-testid="style-tile-motion-sample-${group.key}"`);
      expect(initialHtml).toContain(`data-schematic-id="${selectedId}"`);
      expect(initialHtml).toContain(`data-testid="motion-trigger-${selectedId}"`);
      expect(initialHtml).toContain(`data-testid="style-tile-jump-${group.key}"`);
    }
    expect(initialHtml).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);

    // Triggering two samples inside the Style Tile updates their live stages
    steps = triggerMotionSchematic(steps, selection.detailOpen);
    steps = triggerMotionSchematic(steps, selection.approvalAndFeedback);

    const triggeredHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <StyleTileMotionSampleStrip
          selection={selection}
          palette={palette}
          domainNouns={nouns}
          stageSteps={steps}
        />
      </PreferencesProvider>,
    );
    expect(triggeredHtml.match(/data-stage-phase="active"/g)).toHaveLength(2);
  });
});

describe('Reduced motion accessibility (prefers-reduced-motion: reduce)', () => {
  it('detects window.matchMedia("(prefers-reduced-motion: reduce)") and switches stages to 0ms instant toggles without spatial transforms', () => {
    stubLocale('zh-CN');
    vi.stubGlobal('window', {
      matchMedia: vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    const galleryHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <MotionSchematicGallery srsMarkdown="采购合同审批与批量导出" />
      </PreferencesProvider>,
    );

    expect(galleryHtml).toContain('data-reduced-motion="true"');
    expect(galleryHtml).toContain('0ms');
    expect(galleryHtml).not.toMatch(/style="[^"]*(?:translateX|translateY|scale)\(/);

    const stripTriggeredHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <StyleTileMotionSampleStrip
          srsMarkdown="采购合同审批"
          stageSteps={{ DRAWER: 1, STEPPER_CORNER_TOAST: 1 }}
        />
      </PreferencesProvider>,
    );
    expect(stripTriggeredHtml).toContain('data-reduced-motion="true"');
    expect(stripTriggeredHtml.match(/data-stage-phase="active"/g)).toHaveLength(2);
    expect(stripTriggeredHtml).not.toMatch(/style="[^"]*(?:translateX|translateY|scale)\(/);
  });
});

describe('PrototypeCoDesignStudio integration & backward compatibility', () => {
  it('wires 7-group SRS pre-selection, domain nouns, and hard-constraint MotionSpecs into PrototypeCoDesignStudio', () => {
    stubLocale('zh-CN');
    const mockProject: ProjectDetail = {
      id: 'proj-contract',
      name: '采购合同管理工程',
      code: 'PROJ_CONTRACT',
      center: 'APPLICATION',
      domain: 'procurement',
      description: '',
      currentStage: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      suite: {},
      validation: {
        valid: true,
        errorCount: 0,
        warningCount: 0,
        diagnostics: [],
        presentModels: [],
        missingModels: [],
      },
      knowledgeGraph: { nodes: [], edges: [] },
      changelog: '',
    };

    const referenceSelection = createInitialVisualReferenceSelection(CURATED_INSPO_CATALOG[0]!);
    const brief = buildDesignBriefFromState({
      project: mockProject,
      referenceSelection,
      alignment: DEFAULT_ALIGNMENT_STATE,
      locale: 'zh-CN',
    });
    const prompt = compileDesignBriefGenerationPrompt({
      project: mockProject,
      brief,
      referenceSelection,
      alignment: DEFAULT_ALIGNMENT_STATE,
      locale: 'zh-CN',
    });
    expect(prompt.match(/\[硬性约束 \/ MUST SATISFY\]/g)).toHaveLength(7);
    expect(prompt.match(/\[示例代码（可按页面结构改写） \/ ADAPTIVE EXAMPLE\]/g)).toHaveLength(7);

    const noop = () => {};
    const studioStep2Html = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCoDesignStudio
          project={mockProject}
          docs={[
            {
              id: 'doc-1',
              projectId: 'proj-contract',
              title: '采购合同SRS',
              version: 'v1.0',
              status: 'CONFIRMED',
              content:
                '## 范围\n支持**采购合同**（Purchase Contract）与**付款里程碑**（Payment Milestone）财务台账批量审批及会签。',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ]}
          selectedDocId="doc-1"
          onSelectDocId={noop}
          prototypes={[]}
          selectedProtoId=""
          onSelectProtoId={noop}
          activeStep={2}
          onStepChange={noop}
          previewSource="REFERENCE_DRAFT"
          onPreviewSourceChange={noop}
          savedHtmlContent=""
          onSavedHtmlContentChange={noop}
          onDraftHtmlChange={noop}
          onSaveDraftAsPrototype={async () => {}}
          onGenerateWithAi={async () => {}}
          onCloneVersion={noop}
          onDeleteProto={noop}
          onDownloadHtml={noop}
          inspectMode={false}
          onInspectModeChange={noop}
          visualAnnotations={[]}
          onAddVisualAnnotation={noop}
          onRemoveVisualAnnotation={noop}
          onClearVisualAnnotations={noop}
          refineInstruction=""
          onRefineInstructionChange={noop}
          onApplyRefine={async () => {}}
          isBusyProto={false}
        />
      </PreferencesProvider>,
    );

    expect(studioStep2Html).toContain('data-testid="motion-schematic-gallery"');
    expect(studioStep2Html).toContain('采购合同');
    expect(studioStep2Html).toContain('付款里程碑');
    expect(studioStep2Html).toContain('data-testid="motion-group-approvalAndFeedback"');
  });

  it('synchronizes 7-group selection updates back into RequirementAlignmentState cleanly', () => {
    const nextSelection = {
      detailOpen: 'DEDICATED_TAB' as const,
      informationDensity: 'MODULAR_CARDS' as const,
      navigationStructure: 'TOP_SEGMENTED_HUB' as const,
      tableRowActions: 'INLINE_QUICK_EDIT' as const,
      formValidationSave: 'AUTOSAVE_DRAFT_BADGE' as const,
      emptyAndLoading: 'SKELETON_SHIMMER' as const,
      approvalAndFeedback: 'STEPPER_CORNER_TOAST' as const,
    };

    const synced = syncAlignmentWithSelection(DEFAULT_ALIGNMENT_STATE, nextSelection);
    expect(synced.entryPattern).toBe('DEDICATED_TAB');
    expect(synced.layoutDensity).toBe('MODULAR_CARDS');
    expect(synced.navigationStructure).toBe('TOP_SEGMENTED_HUB');
    expect(synced.feedbackMotions).toContain('SKELETON');
    expect(synced.feedbackMotions).toContain('TOAST');
    expect(resolveMotionSelection(synced)).toEqual(nextSelection);
  });
});





