import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURATED_INSPO_CATALOG,
  createWorkspaceStore,
  type AgentImageAttachmentRef,
  type InteractivePrototype,
  type ProjectDetail,
  type RequirementDoc,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import {
  resetLocalImageStoreForTests,
  storeUploadedOrPastedImage,
} from '../../lib/localImageStore.js';
import { PrototypeStudioView } from '../../views/ApplicationCenterViews.js';
import { useAgentPanelStore } from '../agent/agentPanelStore.js';
import { ShellAgentPanel, agentPanelSurfaceFor } from '../agent/ShellAgentPanel.js';
import {
  DesignBriefCard,
  StyleTileCard,
  addDesignBriefItem,
  buildDesignBriefFromState,
  compileDesignBriefGenerationPrompt,
  compileDesignBriefRestylePrompt,
  decideDesignBriefForMe,
  deriveStyleTileTokens,
  gatherBriefingTurnImages,
  hydrateBriefingStateFromDesignBrief,
  removeDesignBriefItem,
  requestDesignBriefAssist,
  rewriteDesignBriefWithInstruction,
  synthesizeDesignBriefItems,
  updateDesignBriefItem,
} from './DesignBriefAndStyleTile.js';
import {
  DEFAULT_ALIGNMENT_STATE,
  inferDefaultAlignmentFromSrs,
} from './MotionSchematicGallery.js';
import * as PrototypeCoDesignStudioModule from './PrototypeCoDesignStudio.js';
import { PrototypeCoDesignStudio } from './PrototypeCoDesignStudio.js';
import {
  createInitialVisualReferenceSelection,
  fetchVisualReferenceDesignSystem,
  recommendVisualReferences,
  selectPrimaryReference,
  upsertBorrowedReference,
} from './VisualReferencePicker.js';

const noop = () => {};

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

function makeMockProject(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'proj-brief-1',
    name: '企业采购合同与资金结算工程',
    code: 'PROJ_CLM_FIN',
    center: 'APPLICATION',
    domain: '金融合同台账与多级审批',
    description: '支持采购合同、付款批次与风控阈值复核',
    currentStage: 3,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
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
    ...overrides,
  };
}

function makeMockSrsDoc(): RequirementDoc {
  return {
    id: 'doc-clm-1',
    projectId: 'proj-brief-1',
    title: '采购合同与付款结算需求规格说明书',
    version: 'v1.0',
    status: 'CONFIRMED',
    content: [
      '## 1. 业务范围',
      '围绕**采购合同**（Purchase Contract）与**付款结算单**（Payment Settlement）构建高密度财务台账。',
      '## 2. 审批规则',
      '单笔金额超过 100,000 元自动进入多级会签审批流，并支持抽屉滑出查看条款明细。',
    ].join('\n'),
    updatedAt: '2026-11-12T00:00:00.000Z',
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await resetLocalImageStoreForTests();
});

describe('Ticket 09 (Issue #31): Briefing Stage — Design Brief & Style Tile', () => {
  it('renders single-page two-column Briefing Stage with Visual References, User Feel & Upload, 7-Group Motion Schematics on the left, Design Brief + Style Tile on the right, and removes legacy prompt/template exports', () => {
    stubLocale('zh-CN');
    const project = makeMockProject();
    const doc = makeMockSrsDoc();

    // Legacy exports must be completely deleted
    expect('buildAgentPrototypeContextPrompt' in PrototypeCoDesignStudioModule).toBe(false);
    expect('buildReferenceStyledPrototypeHtml' in PrototypeCoDesignStudioModule).toBe(false);

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCoDesignStudio
          project={project}
          docs={[doc]}
          selectedDocId={doc.id}
          onSelectDocId={noop}
          prototypes={[]}
          onGenerateWithAi={async () => {}}
          isBusyProto={false}
        />
      </PreferencesProvider>,
    );

    // Left column: 1. Visual references, 2. User local image upload + plain-language feel input, 3. 7-group motion gallery
    expect(html).toContain('data-testid="prototype-briefing-stage"');
    expect(html).toContain('data-testid="briefing-left-column"');
    expect(html).toContain('data-testid="visual-reference-picker"');
    expect(html).toContain('data-testid="user-feel-and-uploads-card"');
    expect(html).toContain('data-testid="vision-attachment-controls"');
    expect(html).toContain('data-testid="user-feel-note-input"');
    expect(html).toContain('data-testid="motion-schematic-gallery"');

    // Right column: 1. Design Brief card + 2. Live Style Tile card
    expect(html).toContain('data-testid="briefing-right-column"');
    expect(html).toContain('data-testid="design-brief-card"');
    expect(html).toContain('data-testid="decide-for-me-btn"');
    expect(html).toContain('data-testid="brief-one-sentence-input"');
    expect(html).toContain('data-testid="confirm-brief-generate-btn"');
    expect(html).toContain('data-testid="style-tile-card"');
    expect(html).toContain('data-testid="style-tile-motion-strip"');

    // Removals verified: no read-only compiled prompt <details>, no legacy MU sync button, no open <details>
    expect(html).not.toContain('展开查看将发送给 Agent 的完整提示词指令');
    expect(html).not.toContain('View compiled Agent context prompt');
    expect(html).not.toContain('将此参考原型落库并同步 MU');
    expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
  });

  it('synthesizes readable DesignBrief items reflecting user feel notes, supports item-by-item edit/add/remove, one-sentence rewrite, and one-click "帮我定" (Decide for me)', async () => {
    const project = makeMockProject();
    const doc = makeMockSrsDoc();
    const lightRef =
      CURATED_INSPO_CATALOG.find((item) => item.mode === 'light') ?? CURATED_INSPO_CATALOG[0]!;
    const borrowedRef =
      CURATED_INSPO_CATALOG.find((item) => item.slug !== lightRef.slug) ??
      CURATED_INSPO_CATALOG[1]!;

    let selection = createInitialVisualReferenceSelection(lightRef);
    selection = upsertBorrowedReference(selection, borrowedRef, 'accentColor', '喜欢它的亮蓝强调按钮');
    const alignment = inferDefaultAlignmentFromSrs(doc.content, project);
    const feelNote = '想要像银行内部台账那样稳重紧凑、一眼看清待审批金额';

    const items = synthesizeDesignBriefItems({
      project,
      doc,
      referenceSelection: selection,
      alignment,
      userFeelNote: feelNote,
      locale: 'zh-CN',
    });

    expect(items.length).toBeGreaterThanOrEqual(5);
    const joined = items.map((i) => i.statement).join('\n');
    expect(joined).toContain(lightRef.title);
    expect(joined).toContain(borrowedRef.title);
    expect(joined).toContain(feelNote);
    expect(joined).toContain('采购合同');

    let brief = buildDesignBriefFromState({
      project,
      doc,
      referenceSelection: selection,
      alignment,
      userFeelNote: feelNote,
      locale: 'zh-CN',
    });
    expect(brief.userFeelNote).toBe(feelNote);
    expect(brief.primaryReferenceId).toBe(lightRef.slug);
    expect(brief.borrowedReferences).toHaveLength(1);
    expect(brief.borrowedReferences?.[0]?.aspect).toBe('accentColor');

    // Item-by-item edit, add, remove
    const firstId = brief.items[0]!.id;
    brief = updateDesignBriefItem(brief, firstId, '手工微调后的主色调说明：采用沉稳藏青配暖白纸底');
    expect(brief.items.find((i) => i.id === firstId)?.statement).toBe(
      '手工微调后的主色调说明：采用沉稳藏青配暖白纸底',
    );

    brief = addDesignBriefItem(brief, '所有金额数字右对齐并保留两位小数，超阈值显示琥珀色徽标');
    expect(
      brief.items.some((i) =>
        i.statement.includes('所有金额数字右对齐并保留两位小数'),
      ),
    ).toBe(true);

    const countBeforeRemove = brief.items.length;
    brief = removeDesignBriefItem(brief, firstId);
    expect(brief.items).toHaveLength(countBeforeRemove - 1);
    expect(brief.items.some((i) => i.id === firstId)).toBe(false);

    // One-sentence rewrite ("改成深色高密度交易风")
    const rewritten = rewriteDesignBriefWithInstruction({
      brief,
      instruction: '改成深色高密度交易风',
      referenceSelection: selection,
      alignment,
      catalog: CURATED_INSPO_CATALOG,
      locale: 'zh-CN',
    });
    expect(rewritten.nextReferenceSelection.primary.mode).toBe('dark');
    expect(rewritten.nextAlignment.layoutDensity).toBe('COMPACT_LEDGER');
    expect(
      rewritten.brief.items.some((i) => i.statement.includes('深色高密度交易风')),
    ).toBe(true);

    // "帮我定" (Decide for me) one-click recommendation + SRS motion inference
    const fakeFetch = vi.fn(async () => {
      const fintechItem =
        CURATED_INSPO_CATALOG.find((c) => c.vibeGroup === 'fintech') ?? CURATED_INSPO_CATALOG[0]!;
      return new Response(
        JSON.stringify({
          ok: true,
          source: 'curated',
          items: [fintechItem],
          pick: fintechItem,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const decided = await decideDesignBriefForMe({
      project,
      doc,
      catalog: CURATED_INSPO_CATALOG,
      locale: 'zh-CN',
      fetchFn: fakeFetch,
    });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(decided.referenceSelection.primary.slug).toBeTruthy();
    expect(decided.brief.items.length).toBeGreaterThanOrEqual(5);
    expect(decided.brief.motionSchematicIds?.length).toBeGreaterThanOrEqual(7);
  });

  it('updates live Style Tile swatches, typography, Buttons, Card, Table, Status Badges, and playable Motion Strip in real time as Primary/Borrowed references or feel notes change', () => {
    stubLocale('zh-CN');
    const project = makeMockProject();
    const doc = makeMockSrsDoc();
    const primaryLight =
      CURATED_INSPO_CATALOG.find((c) => c.mode === 'light') ?? CURATED_INSPO_CATALOG[0]!;
    const darkDonor =
      CURATED_INSPO_CATALOG.find(
        (c) => c.mode === 'dark' && c.slug !== primaryLight.slug,
      ) ?? CURATED_INSPO_CATALOG[1]!;

    const baseSel = createInitialVisualReferenceSelection(primaryLight);
    const tokensBase = deriveStyleTileTokens(baseSel, DEFAULT_ALIGNMENT_STATE, '');
    expect(tokensBase.surfaceHex.toLowerCase()).toBe(primaryLight.surfaceHex.toLowerCase());
    expect(tokensBase.accentHex.toLowerCase()).toBe(primaryLight.palette[0]!.toLowerCase());

    // Borrow accentColor from darkDonor -> accentHex changes immediately while surface stays primaryLight
    const borrowedAccentSel = upsertBorrowedReference(baseSel, darkDonor, 'accentColor');
    const tokensBorrowedAccent = deriveStyleTileTokens(
      borrowedAccentSel,
      DEFAULT_ALIGNMENT_STATE,
      '',
    );
    expect(tokensBorrowedAccent.surfaceHex.toLowerCase()).toBe(
      primaryLight.surfaceHex.toLowerCase(),
    );
    expect(tokensBorrowedAccent.accentHex.toLowerCase()).toBe(
      darkDonor.palette[0]!.toLowerCase(),
    );

    // Switch Primary to darkDonor -> mode & surfaceHex immediately flip to dark
    const switchedPrimarySel = selectPrimaryReference(borrowedAccentSel, darkDonor);
    const tokensDark = deriveStyleTileTokens(switchedPrimarySel, DEFAULT_ALIGNMENT_STATE, '');
    expect(tokensDark.mode).toBe('dark');
    expect(tokensDark.surfaceHex.toLowerCase()).toBe(darkDonor.surfaceHex.toLowerCase());

    const tileHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <StyleTileCard
          tokens={tokensBorrowedAccent}
          referenceSelection={borrowedAccentSel}
          alignment={DEFAULT_ALIGNMENT_STATE}
          project={project}
          srsMarkdown={doc.content}
        />
      </PreferencesProvider>,
    );

    // Color swatches + hexes
    expect(tileHtml).toContain('data-testid="style-tile-swatches"');
    expect(tileHtml.toLowerCase()).toContain(tokensBorrowedAccent.surfaceHex.toLowerCase());
    expect(tileHtml.toLowerCase()).toContain(tokensBorrowedAccent.accentHex.toLowerCase());

    // Typography specimen + tabular-nums figure
    expect(tileHtml).toContain('data-testid="style-tile-typography"');
    expect(tileHtml).toContain('tabular-nums');

    // Representative UI micro-specimens: Buttons, Card, Table (2-3 SRS rows), Status Badges
    expect(tileHtml).toContain('data-testid="style-tile-buttons"');
    expect(tileHtml).toContain('data-testid="style-tile-card-specimen"');
    expect(tileHtml).toContain('data-testid="style-tile-table-specimen"');
    expect(tileHtml).toContain('data-testid="style-tile-badges"');
    expect(tileHtml).toContain('采购合同');
    expect(tileHtml).toContain('付款结算单');

    // Playable selected motion schematics strip
    expect(tileHtml).toContain('data-testid="style-tile-motion-strip"');
  });

  it('fetches Inspo DESIGN.md, gathers Primary + Borrowed + browser-local uploaded images, compiles responsive + semantic-anchor prompt, and shows vision fallback notice when !supportsVision', async () => {
    const project = makeMockProject();
    const doc = makeMockSrsDoc();
    const primary = CURATED_INSPO_CATALOG[0]!;
    const borrowed = CURATED_INSPO_CATALOG[1]!;
    const selection = upsertBorrowedReference(
      createInitialVisualReferenceSelection(primary),
      borrowed,
      'cardBorder',
    );

    // Store a browser-local user reference image in localImageStore
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const blob = new Blob([pngBytes], { type: 'image/png' });
    const { ref: localRef } = await storeUploadedOrPastedImage(blob, {
      name: 'bank-internal-ledger.png',
      role: 'user_upload',
      width: 1280,
      height: 800,
    });
    const localAttachments: AgentImageAttachmentRef[] = [localRef];

    const turnImages = await gatherBriefingTurnImages({
      referenceSelection: selection,
      localAttachments,
      locale: 'zh-CN',
    });
    expect(turnImages).toHaveLength(3);
    expect(turnImages[0]?.role).toBe('primary_ref');
    expect(turnImages[0]?.remoteUrl).toBe(primary.fullPageUrl);
    expect(turnImages[0]?.remoteUrl).toContain('full.');
    expect(turnImages[1]?.role).toBe('borrowed_ref');
    expect(turnImages[1]?.remoteUrl).toContain(borrowed.slug);
    expect(turnImages[2]?.role).toBe('user_upload');
    expect(turnImages[2]?.name).toBe('bank-internal-ledger.png');
    expect(turnImages[2]?.dataBase64).toBeTruthy();

    // Fetch Inspo DESIGN.md via helper
    const fakeDesignFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          source: 'curated',
          slug: primary.slug,
          markdown: `# ${primary.title} DESIGN.md\n:root { --surface: ${primary.surfaceHex}; }`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const designSys = await fetchVisualReferenceDesignSystem(primary.slug, fakeDesignFetch);
    expect(designSys.markdown).toContain('DESIGN.md');
    expect(designSys.markdown).toContain(primary.surfaceHex);

    const recRes = await recommendVisualReferences({ projectId: project.id }, fakeDesignFetch);
    expect(recRes.items.length).toBeGreaterThan(0);

    const brief = buildDesignBriefFromState({
      project,
      doc,
      referenceSelection: selection,
      alignment: DEFAULT_ALIGNMENT_STATE,
      userFeelNote: '稳重紧凑台账风',
      localAttachmentCount: 1,
      locale: 'zh-CN',
    });

    const compiledPrompt = compileDesignBriefGenerationPrompt({
      project,
      doc,
      brief,
      referenceSelection: selection,
      alignment: DEFAULT_ALIGNMENT_STATE,
      designSystemMarkdown: designSys.markdown,
      locale: 'zh-CN',
    });

    // Must contain confirmed Design Brief, DESIGN.md tokens, all 7 motion specs, SRS content, semantic anchors, and 1440/768/390 responsive contract
    expect(compiledPrompt).toContain('稳重紧凑台账风');
    expect(compiledPrompt).toContain('DESIGN.md');
    expect(compiledPrompt.match(/\[硬性约束 \/ MUST SATISFY\]/g)).toHaveLength(7);
    expect(compiledPrompt.match(/\[示例代码（可按页面结构改写） \/ ADAPTIVE EXAMPLE\]/g)).toHaveLength(7);
    expect(compiledPrompt).toContain('采购合同与付款结算需求规格说明书');
    expect(compiledPrompt).toContain('data-screen-id');
    expect(compiledPrompt).toContain('data-element-id');
    expect(compiledPrompt).toContain('data-binding');
    expect(compiledPrompt).toContain('data-event-id');
    expect(compiledPrompt).toContain('1440px');
    expect(compiledPrompt).toContain('768px');
    expect(compiledPrompt).toContain('390px');

    const restylePrompt = compileDesignBriefRestylePrompt({
      project,
      doc,
      brief,
      referenceSelection: selection,
      alignment: DEFAULT_ALIGNMENT_STATE,
      designSystemMarkdown: designSys.markdown,
      locale: 'zh-CN',
    });
    expect(restylePrompt).toContain('[PROTOTYPE_BRIEF_RESTYLE]');
    expect(restylePrompt).toContain('按新简报重做风格');

    // When visionSupported === false, Briefing Stage & DesignBriefCard display explicit non-silent fallback banner with link to LLM Center
    stubLocale('zh-CN');
    const noVisionHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCoDesignStudio
          project={project}
          docs={[doc]}
          selectedDocId={doc.id}
          onSelectDocId={noop}
          prototypes={[]}
          onGenerateWithAi={async () => {}}
          visionSupported={false}
          visionProviderLabel="Text-Only Gateway"
          onOpenLlmCenter={noop}
          isBusyProto={false}
        />
      </PreferencesProvider>,
    );
    expect(noVisionHtml).toContain('data-testid="vision-fallback-banner"');
    expect(noVisionHtml).toContain('当前模型看不了图，将只使用文字设计说明');
    expect(noVisionHtml).toContain('data-testid="vision-open-llm-center-btn"');
  });

  it('pre-populates Design Brief when returning from Canvas Stage with an activePrototype and renders "按新简报重做风格" CTA', () => {
    stubLocale('zh-CN');
    const project = makeMockProject();
    const doc = makeMockSrsDoc();
    const targetRef = CURATED_INSPO_CATALOG[2] ?? CURATED_INSPO_CATALOG[0]!;

    const existingProto: InteractivePrototype = {
      id: 'proto-existing-1',
      projectId: project.id,
      name: '采购台账原型 V1',
      version: 'v1.0',
      htmlContent:
        '<!doctype html><html><body><section data-screen-id="SCR-1" data-screen-name="台账" data-screen-type="LIST"><button type="button" data-element-id="EL-1" data-element-type="BUTTON">新建</button></section></body></html>',
      extractedScreenCount: 1,
      createdAt: '2026-11-12T08:00:00.000Z',
      updatedAt: '2026-11-12T08:00:00.000Z',
      currentRevisionId: 'rev-1',
      coDesignSessionId: 'asess-proto-1',
      isConfirmed: false,
      aheadOfConfirmedCount: 1,
      designBrief: {
        items: [
          {
            id: 'saved-1',
            category: 'tone_palette',
            statement: '已保存简报条目：采用高对比深灰边框与琥珀预警徽标',
          },
        ],
        userFeelNote: '已保存的银行级审批感受备注',
        primaryReferenceId: targetRef.slug,
        primaryReferenceTitle: targetRef.title,
        primaryReferenceSourceUrl: targetRef.sourceUrl,
        motionSchematicIds: ['MODAL', 'MODULAR_CARDS'],
        updatedAt: '2026-11-12T08:00:00.000Z',
      },
      revisions: [
        {
          id: 'rev-1',
          prototypeId: 'proto-existing-1',
          projectId: project.id,
          revisionNumber: 1,
          title: 'R1 Initial',
          htmlContent:
            '<!doctype html><html><body><section data-screen-id="SCR-1" data-screen-name="台账" data-screen-type="LIST"><button type="button" data-element-id="EL-1" data-element-type="BUTTON">新建</button></section></body></html>',
          extractedScreenCount: 1,
          source: 'AGENT_RUN',
          createdAt: '2026-11-12T08:00:00.000Z',
        },
      ],
    };

    const hydrated = hydrateBriefingStateFromDesignBrief(
      existingProto.designBrief!,
      CURATED_INSPO_CATALOG,
      DEFAULT_ALIGNMENT_STATE,
    );
    expect(hydrated.referenceSelection.primary.slug).toBe(targetRef.slug);
    expect(hydrated.userFeelNote).toBe('已保存的银行级审批感受备注');
    expect(hydrated.alignment.entryPattern).toBe('MODAL');
    expect(hydrated.alignment.layoutDensity).toBe('MODULAR_CARDS');

    const studioHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCoDesignStudio
          project={project}
          docs={[doc]}
          selectedDocId={doc.id}
          onSelectDocId={noop}
          prototypes={[existingProto]}
          activePrototype={existingProto}
          onGenerateWithAi={async () => {}}
          onBackToCanvas={noop}
          isBusyProto={false}
        />
      </PreferencesProvider>,
    );

    expect(studioHtml).toContain('已保存简报条目：采用高对比深灰边框与琥珀预警徽标');
    expect(studioHtml).toContain('已保存的银行级审批感受备注');
    expect(studioHtml).toContain('data-testid="confirm-brief-restyle-btn"');
    expect(studioHtml).toContain('按新简报重做风格');
  });

  it('persists userImageRefs on DesignBrief, renders "图片已不在本机" in Briefing Stage when IndexedDB is cleared, and connects to POST /api/projects/:id/design-brief-assist with graceful 404 fallback', async () => {
    stubLocale('zh-CN');
    const project = makeMockProject();
    const doc = makeMockSrsDoc();

    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { ref: uploadedRef } = await storeUploadedOrPastedImage(
      new Blob([pngBytes], { type: 'image/png' }),
      {
        id: 'brief-local-img-1',
        name: 'treasury-reference.png',
        role: 'user_upload',
      },
    );

    const briefWithImages = buildDesignBriefFromState({
      project,
      doc,
      referenceSelection: createInitialVisualReferenceSelection(CURATED_INSPO_CATALOG[0]!),
      alignment: DEFAULT_ALIGNMENT_STATE,
      userImageRefs: [uploadedRef],
      locale: 'zh-CN',
    });
    expect(briefWithImages.userImageRefs).toEqual([uploadedRef]);

    // Test agent-backed design-brief-assist endpoint with vision image base64 payload
    let capturedBody: Record<string, unknown> | undefined;
    const assistFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          ok: true,
          source: 'agent',
          brief: {
            positioning: '面向资金结算高密度审阅的暖纸台账工作台',
            colorMood: '暖白纸感画布搭配深靛蓝主操作色',
            typography: 'IBM Plex Sans 与等宽数字对齐',
            layoutDensity: '高密度紧凑台账，三端自适应',
            keyScreenStructure: '覆盖采购合同列表、付款批次详情抽屉与审批流',
            componentTone: '6px 利落圆角，零原生阻塞弹窗',
            constraints: '全部交互控件保留 MU 语义锚点',
            openNotes: '已结合本机上传截图强化金额列视觉权重',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const assisted = await requestDesignBriefAssist({
      projectId: project.id,
      mode: 'rewrite',
      instruction: '强化金额列对比度',
      project,
      doc,
      currentBrief: briefWithImages,
      referenceSelection: createInitialVisualReferenceSelection(CURATED_INSPO_CATALOG[0]!),
      visionImages: [uploadedRef],
      fetchFn: assistFetch,
    });
    expect(assisted?.source).toBe('agent');
    expect(assisted?.items.some((i) => i.statement.includes('面向资金结算高密度审阅'))).toBe(true);
    expect((capturedBody?.images as Array<{ imageId: string }> | undefined)?.[0]?.imageId).toBe(
      'brief-local-img-1',
    );

    // Graceful fallback to null on 404 or missing projectId
    const notFoundFetch = vi.fn(
      async () => new Response('Not Found', { status: 404 }),
    ) as unknown as typeof fetch;
    expect(
      await requestDesignBriefAssist({
        projectId: project.id,
        mode: 'synthesize',
        fetchFn: notFoundFetch,
      }),
    ).toBeNull();
    expect(
      await requestDesignBriefAssist({
        mode: 'synthesize',
        fetchFn: assistFetch,
      }),
    ).toBeNull();

    // Clear localImageStore (simulating another device or cleared IndexedDB) -> Briefing Stage renders "图片已不在本机"
    await resetLocalImageStoreForTests();
    const protoWithMissingLocalImg: InteractivePrototype = {
      id: 'proto-missing-img',
      projectId: project.id,
      name: '跨设备打开原型',
      version: 'v1.0',
      htmlContent:
        '<!doctype html><html><body><section data-screen-id="SCR-1" data-screen-name="台账" data-screen-type="LIST"></section></body></html>',
      extractedScreenCount: 1,
      createdAt: '2026-11-12T08:00:00.000Z',
      updatedAt: '2026-11-12T08:00:00.000Z',
      currentRevisionId: 'rev-1',
      isConfirmed: false,
      aheadOfConfirmedCount: 0,
      designBrief: briefWithImages,
      revisions: [
        {
          id: 'rev-1',
          prototypeId: 'proto-missing-img',
          projectId: project.id,
          revisionNumber: 1,
          title: 'R1',
          htmlContent:
            '<!doctype html><html><body><section data-screen-id="SCR-1" data-screen-name="台账" data-screen-type="LIST"></section></body></html>',
          extractedScreenCount: 1,
          source: 'AGENT_RUN',
          createdAt: '2026-11-12T08:00:00.000Z',
        },
      ],
    };

    const clearedHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCoDesignStudio
          project={project}
          docs={[doc]}
          selectedDocId={doc.id}
          onSelectDocId={noop}
          prototypes={[protoWithMissingLocalImg]}
          activePrototype={protoWithMissingLocalImg}
          onGenerateWithAi={async () => {}}
          isBusyProto={false}
        />
      </PreferencesProvider>,
    );
    expect(clearedHtml).toContain('data-testid="design-brief-image-refs"');
    expect(clearedHtml).toContain('图片已不在本机');
    expect(clearedHtml).toContain('treasury-reference.png');
  });

  it('executes end-to-end startPrototypeBriefGenerationRun (creating Revision #1 without legacy PROTOTYPE_GEN task) and startPrototypeBriefRestyleRun (creating Revision #2) via Hono API & ShellAgentPanel', async () => {
    stubLocale('zh-CN');
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    // Enable explicit Mock mode in store settings for deterministic SSE execution
    store.updateSystemSettings({ mockLlmMode: true });
    // Configure provider with supportsVision: false to also verify ShellAgentPanel fallback banner!
    for (const p of store.listLlmProviders()) {
      store.saveLlmProvider({ ...p, enabled: false });
    }
    store.saveLlmProvider({
      id: 'llm-text-only',
      name: 'TextOnlyMockGateway',
      providerType: 'OPENAI_COMPATIBLE',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'k',
      defaultModel: 'deepseek-chat',
      availableModels: ['deepseek-chat'],
      supportsVision: false,
      enabled: true,
    });

    // Create a clean empty project so we start at 0 prototypes (Briefing Stage)
    const e2eProject = store.createProject({
      name: '企业采购合同台账工程',
      code: 'PROJ_BRIEF_E2E',
      center: 'APPLICATION',
      domain: 'procurement',
      template: 'EMPTY',
    });
    store.saveRequirementDoc({
      id: 'rdoc-brief-e2e-1',
      projectId: e2eProject.id,
      title: '采购合同与付款结算SRS',
      version: 'v1.0',
      status: 'CONFIRMED',
      content: '围绕**采购合同**（Purchase Contract）与**付款结算单**（Payment Settlement）管理多级审批。',
    });
    expect(store.listPrototypes(e2eProject.id)).toHaveLength(0);

    const app = createApiApp(store);
    const pipelineTaskCalls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (rawUrl.includes('/api/pipeline-tasks')) {
        pipelineTaskCalls.push(rawUrl);
      }
      const resolvedUrl = rawUrl.startsWith('http') ? rawUrl : `http://localhost${rawUrl}`;
      return app.request(resolvedUrl, init);
    });

    await useWorkbenchStore.getState().bootstrap(e2eProject.id);
    useWorkbenchStore.getState().setActiveNav('app-prototype');
    useAgentPanelStore.setState({ open: false });

    const activeProject = useWorkbenchStore.getState().data!.activeProject;
    const docs = useWorkbenchStore.getState().data!.requirementDocs;
    const briefR1 = buildDesignBriefFromState({
      project: activeProject,
      doc: docs[0],
      referenceSelection: createInitialVisualReferenceSelection(CURATED_INSPO_CATALOG[0]!),
      alignment: DEFAULT_ALIGNMENT_STATE,
      userFeelNote: '稳重紧凑合同台账',
      locale: 'zh-CN',
    });

    const genRes = await useWorkbenchStore.getState().startPrototypeBriefGenerationRun({
      projectId: activeProject.id,
      prototypeName: '简报生成合同原型',
      prompt: '请按确认设计简报生成响应式采购合同原型（1440px / 768px / 390px）',
      designBrief: briefR1,
      images: [
        {
          id: 'ref-1',
          name: 'Amie Hero',
          mimeType: 'image/webp',
          remoteUrl: 'https://inspomcp.dev/hero.webp',
          role: 'primary_ref',
          textFallbackNote: 'Amie清爽浅色参考说明',
        },
      ],
      mockMode: true,
      awaitCompletion: true,
    });

    // Must NOT call legacy /api/pipeline-tasks PROTOTYPE_GEN!
    expect(pipelineTaskCalls).toHaveLength(0);
    // Must reveal ShellAgentPanel
    expect(useAgentPanelStore.getState().open).toBe(true);
    expect(genRes.sessionId).toBeTruthy();

    const prototypesAfterR1 = useWorkbenchStore.getState().data!.prototypes;
    expect(prototypesAfterR1).toHaveLength(1);
    const createdProto = prototypesAfterR1[0]!;
    expect(createdProto.name).toBe('简报生成合同原型');
    expect(createdProto.revisions).toHaveLength(1);
    expect(createdProto.revisions[0]!.revisionNumber).toBe(1);
    expect(createdProto.revisions[0]!.source).toBe('AGENT_RUN');
    expect(createdProto.designBrief?.userFeelNote).toBe('稳重紧凑合同台账');
    expect(
      useWorkbenchStore.getState().activePrototypeIdByProject[activeProject.id],
    ).toBe(createdProto.id);

    // PrototypeStudioView now automatically renders Canvas Stage (not Briefing Stage)
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    const studioAfterR1Html = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );
    expect(studioAfterR1Html).toContain('data-testid="prototype-canvas-stage"');

    // ShellAgentPanel renders the completed PROTOTYPE_CO_DESIGN Run Card AND the !supportsVision notice with link to llm-center
    const surface = agentPanelSurfaceFor('app-prototype')!;
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    const panelHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel
          surface={surface}
          overlay={false}
          onClose={noop}
          onNavigate={noop}
        />
      </PreferencesProvider>,
    );
    expect(panelHtml).toContain('data-testid="vision-fallback-banner"');
    expect(panelHtml).toContain('当前模型看不了图，将只使用文字设计说明');
    expect(panelHtml).toContain('data-testid="agent-run-open-artifact-btn"');
    expect(panelHtml).toContain('查看修订 v1');

    // Now update Design Brief & trigger "按新简报重做风格" (Restyle from updated brief) -> Revision #2!
    const updatedBrief = {
      ...briefR1,
      userFeelNote: '改成深色高密度交易风',
      items: [
        ...briefR1.items,
        {
          id: 'brief-restyle-dark',
          category: 'tone_palette',
          statement: '改成深色高密度交易风（画布 #0b1120，强调色 #38bdf8）',
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    await useWorkbenchStore.getState().startPrototypeBriefRestyleRun({
      projectId: activeProject.id,
      prototypeId: createdProto.id,
      prompt: '[PROTOTYPE_BRIEF_RESTYLE] 按新简报重做风格：画布 #0b1120，强调色 #38bdf8',
      designBrief: updatedBrief,
      mockMode: true,
      awaitCompletion: true,
    });

    const prototypesAfterR2 = useWorkbenchStore.getState().data!.prototypes;
    expect(prototypesAfterR2).toHaveLength(1);
    expect(prototypesAfterR2[0]!.revisions).toHaveLength(2);
    expect(prototypesAfterR2[0]!.revisions.at(-1)!.revisionNumber).toBe(2);
    expect(prototypesAfterR2[0]!.designBrief?.userFeelNote).toBe('改成深色高密度交易风');

    // Also verify PUT /api/prototypes/:id/design-brief directly
    const putRes = await fetch(`/api/prototypes/${createdProto.id}/design-brief`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        designBrief: {
          ...updatedBrief,
          userFeelNote: 'PUT 方式保存的设计简报备注',
        },
      }),
    });
    expect(putRes.ok).toBe(true);
    const putJson = (await putRes.json()) as { prototype: InteractivePrototype };
    expect(putJson.prototype.designBrief?.userFeelNote).toBe('PUT 方式保存的设计简报备注');
  });
});
