import { expect, test } from '@playwright/test';

test.describe('Ontology Plus Full-Stack Platform E2E', () => {
  test.beforeEach(({ page }) => {
    // Enforce AGENTS.md contract across every E2E scenario: zero blocking browser dialogs
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('1. Shell navigation, Warm-Paper / Film-Grain 3-state theme sync, zh-CN / en-US locale, Unified Agent Panel Wide Mode, 11-model structured/graph/YAML workbench & atomic cascade rename', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Verify initial light theme, business-language health status, and Conversation-left + Canvas-right layout
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('shell-health-status')).toContainText('没有需要修正的问题');
    await expect(page.getByTestId('business-model-business-view')).toBeVisible();
    const agentPanel = page.getByTestId('agent-panel');
    const canvas = page.getByTestId('workbench-canvas');
    await expect(agentPanel).toBeVisible();
    await expect(canvas).toBeVisible();
    const agentBox = await agentPanel.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(agentBox!.x).toBeLessThan(canvasBox!.x);
    await expect(agentPanel).toHaveAttribute('data-wide-mode', 'false');

    // Toggle Wide Mode on and off in AgentPanel
    await page.getByTestId('agent-panel-wide-toggle').click();
    await expect(agentPanel).toHaveAttribute('data-wide-mode', 'true');
    await page.getByTestId('agent-panel-wide-toggle').click();
    await expect(agentPanel).toHaveAttribute('data-wide-mode', 'false');

    // 2. Toggle Dark Mode (Film Grain) and back to Light Mode (Warm Paper)
    await page.getByTestId('theme-toggle-btn').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-toggle-btn').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // 3. Toggle Bilingual Locale (zh-CN <-> en-US)
    await page.getByTestId('locale-toggle-btn').click();
    await expect(page.getByTestId('step-tab-BUSINESS_MODEL')).toContainText('Business Model');
    await expect(page.getByTestId('shell-health-status')).toContainText('No problems to fix');
    await expect(page.getByTestId('open-technical-details-btn')).toContainText('Technical Details');
    await page.getByTestId('locale-toggle-btn').click();
    await expect(page.getByTestId('step-tab-BUSINESS_MODEL')).toContainText('业务模型');
    await expect(page.getByTestId('open-technical-details-btn')).toContainText('技术细节');

    // 4. Open Technical Details & navigate across M1, M2, MU in the 11-model workbench & Quick-Add with Undo/Redo
    await page.getByTestId('open-technical-details-btn').click();
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');
    await page.getByTestId('model-nav-M2').click();
    await expect(page.locator('.workbench-center')).toContainText('BHV-01');
    await page.getByTestId('model-nav-MU').click();
    await expect(page.locator('.workbench-center')).toContainText('SCR-CONTRACT-LIST');
    await page.getByTestId('model-nav-M1').click();

    await page.getByTestId('add-model-item-btn').click();
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');
    await page.getByTestId('undo-btn').click();
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');

    // 5. Explore Interactive Knowledge Graph with edge filter & zoom controls
    await page.getByTestId('tech-tab-graph').click();
    await expect(page.getByTestId('kg-edge-filter')).toBeVisible();
    await page.getByTestId('kg-zoom-in-btn').click();

    // 6. Return to Ontology Workbench -> Open non-blocking Cascade Rename & Impact Analysis modal
    await page.getByTestId('tech-tab-editor').click();
    await page.getByTestId('open-cascade-rename-btn').click();
    await page.getByTestId('cascade-rename-new-input').fill('Contract');
    await page.getByTestId('confirm-cascade-rename-btn').click();
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');
  });

  test('2. Application Center forward discovery via Unified ShellAgentPanel: Requirement Exploration + SRS synthesis, Prototype Briefing/Canvas localized refinement + Confirm Revision MU sync, AI Ontology Copilot tool mutation, OWL/Skill/MCP export & 4-Layer ZIP package', async ({
    page,
  }) => {
    await page.goto('/');

    const agentPanel = page.getByTestId('agent-panel');

    // 1. Requirement Exploration (auto Wide Mode) -> Live Requirement turn + One-click 9-part SRS synthesis
    await page.getByTestId('step-tab-REQUIREMENTS').click();
    await expect(agentPanel).toBeVisible();
    await expect(agentPanel).toHaveAttribute('data-wide-mode', 'true');

    await page
      .getByTestId('agent-panel-composer-input')
      .fill('请补充大额采购合同法务会签与分期结算的边界规则');
    await page.getByTestId('agent-panel-send-btn').click();
    await expect(
      agentPanel.locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 25_000 });

    await page.getByTestId('synthesize-srs-btn').click();
    await expect(agentPanel.getByTestId('agent-run-open-artifact-btn').last()).toBeVisible({
      timeout: 25_000,
    });
    await expect(agentPanel).toContainText(/需求规格书|SRS/, { timeout: 25_000 });
    await page.getByTestId('confirm-requirements-btn').click();
    await expect(page.getByTestId('requirements-status-banner')).toHaveAttribute(
      'data-step-state',
      'CONFIRMED',
    );

    // 2. Prototype Co-Design Studio -> Briefing/Canvas toggle, localized refinement in ShellAgentPanel & Confirm This Revision -> MU sync
    await page.getByTestId('step-tab-PROTOTYPE').click();
    await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible();
    await expect(agentPanel).toBeVisible();

    // Verify Briefing Stage <-> Canvas Stage roundtrip
    await page.getByTestId('prototype-back-to-brief-btn').click();
    await expect(page.getByTestId('prototype-briefing-stage')).toBeVisible();
    await page.getByTestId('prototype-back-to-canvas-btn').click();
    await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible();

    // Localized prototype refinement via ShellAgentPanel creates an unconfirmed revision (v2)
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('将新建合同按钮文案改为「立即创建合同」');
    await page.getByTestId('agent-panel-send-btn').click();
    await expect(page.getByTestId('prototype-confirm-revision-btn')).toBeEnabled({
      timeout: 25_000,
    });

    // Confirm This Revision -> MU Diff modal -> Approve -> syncs MU
    await page.getByTestId('prototype-confirm-revision-btn').click();
    await expect(page.getByTestId('confirm-revision-mu-diff-modal')).toBeVisible();
    await page.getByTestId('confirm-revision-approve-btn').click();
    await expect(page.getByTestId('toast-banner')).toContainText(/已确认|原型/);

    // 3. AI Ontology Copilot via Unified ShellAgentPanel -> Execute tool mutation
    await page.getByTestId('step-tab-BUSINESS_MODEL').click();
    await expect(agentPanel).toBeVisible();
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('请新增一条超额采购合同双重风控校验规则');
    await page.getByTestId('agent-panel-send-btn').click();
    await expect(agentPanel.locator('[data-tool-name="upsert_rule"]').first()).toBeVisible({
      timeout: 25_000,
    });
    await expect(
      agentPanel.locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('shell-health-status')).toContainText('没有需要修正的问题');
    const confirmBmRes = await page.request.post(
      '/api/projects/proj-contract/steps/business-model/confirm',
      { data: {} },
    );
    expect(confirmBmRes.ok()).toBe(true);
    await page.getByTestId('open-technical-details-btn').click();
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');

    // 4. Model Files -> Export W3C OWL XML, Generate SKILL.md, Publish MCP Server
    await page.getByTestId('tech-tab-files').click();
    await page.getByTestId('export-owl-btn').click();
    await expect(page.getByTestId('owl-xml-preview')).toContainText('<owl:Ontology');
    await page.locator('.modal-panel button', { hasText: '✕' }).click();

    await page.getByTestId('generate-skill-btn').click();
    await page.getByTestId('publish-mcp-btn').click();

    // 5. 4-Layer Application Assembly -> Coding Agent context + Compile Development Package & verify ZIP endpoint
    await page.getByTestId('step-tab-DELIVERY').click();
    await expect(page.getByTestId('coding-agent-context-card')).toBeVisible();
    await expect(agentPanel).toBeVisible();
    const currentSources = await (await page.request.get('/api/bootstrap?projectId=proj-contract')).json();
    await page.getByTestId('development-prototype-revision').selectOption(currentSources.confirmedPrototypeRevision.revisionId);
    await page.getByTestId('compile-dev-package-btn').click();
    await expect(page.getByTestId('compiled-package-inspector')).toBeVisible();
    await expect(page.getByTestId('compiled-package-inspector')).toContainText('AGENTS.md');
    await expect(page.getByTestId('compiled-package-inspector')).toContainText(
      'docs/implementation.md',
    );
    await expect(page.getByTestId('download-package-zip-btn')).toBeVisible();
  });

  test('3. Capability Center (Ontology Extraction, MCP JSON-RPC, Smart Chat via ShellAgentPanel), Data Analytics (Live SQL, 3-Stage Reasoning & Write-Back via ShellAgentPanel), and Local Pi LLM Gateway', async ({
    page,
  }) => {
    await page.goto('/');

    const agentPanel = page.getByTestId('agent-panel');

    // 1. Capability Center (opened via "更多" menu): Ontology Extraction via Unified ShellAgentPanel (verify "本体萃取" and zero "逆向")
    await page.getByTestId('more-menu-btn').click();
    await page.getByTestId('more-menu-capability').click();
    await page.getByTestId('nav-cap-extraction').click();
    await expect(page.getByTestId('run-extraction-btn')).toBeVisible();
    const bodyText = await page.locator('.platform-content').innerText();
    expect(bodyText).toContain('本体萃取');
    expect(bodyText).not.toContain('逆向');
    await page.getByTestId('run-extraction-btn').click();
    await expect(agentPanel).toBeVisible();
    await expect(
      agentPanel.locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('.platform-content')).toContainText(
      '增量合同变更表与审批接口本体萃取',
      { timeout: 15_000 },
    );

    // 2. Capability Center: Dynamic MCP JSON-RPC 2.0 Tool Call
    await page.getByTestId('nav-cap-mcp').click();
    await page.getByTestId('invoke-mcp-tool-btn').click();
    await expect(page.getByTestId('mcp-rpc-response')).toContainText('"jsonrpc": "2.0"');

    // 3. Capability Center: Smart Chat invoking mounted MCP tool inside Unified ShellAgentPanel (Wide Mode)
    await page.getByTestId('nav-cap-agents').click();
    await expect(page.getByTestId('capability-agent-context-card')).toBeVisible();
    await expect(agentPanel).toBeVisible();
    await expect(agentPanel).toHaveAttribute('data-wide-mode', 'true');
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('请查询当前合同台账并核对大额合同资信准入规则');
    await page.getByTestId('agent-panel-send-btn').click();
    // Steps fold away once a run finishes, so assert they were recorded rather than still on screen.
    await expect(agentPanel.locator('.agent-run-step').first()).toBeAttached({ timeout: 25_000 });
    await expect(
      agentPanel.locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 25_000 });

    // 4. Data Analytics Center (opened via "更多" menu): Live Read-Only SQL Sandbox Preview
    await page.getByTestId('more-menu-btn').click();
    await page.getByTestId('more-menu-analytics').click();
    await page.getByTestId('nav-data-resources').click();
    await page.getByTestId('run-sql-preview-btn').click();
    await expect(page.getByTestId('sql-preview-table')).toBeVisible();

    // 5. Data Analytics Center: 3-Stage Reasoning (Ask Data / Why / Policy) & Closed-Loop Write-Back via ShellAgentPanel
    await page.getByTestId('nav-data-reasoning').click();
    await expect(agentPanel).toBeVisible();
    await expect(agentPanel).toHaveAttribute('data-wide-mode', 'true');
    await page.getByTestId('reasoning-mode-ASK_POLICY').click();
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('请分析当前逾期合同根因并给出自动冻结策略建议');
    await page.getByTestId('agent-panel-send-btn').click();
    await expect(agentPanel.getByTestId('trigger-policy-writeback-btn').first()).toBeVisible({
      timeout: 25_000,
    });
    await agentPanel.getByTestId('trigger-policy-writeback-btn').first().click();
    await expect(page.getByTestId('toast-banner')).toContainText('WB-01');

    // 6. System Settings (opened via "更多" menu) 3-state theme control & LLM Center Local Pi Gateway test
    await page.getByTestId('more-menu-btn').click();
    await page.getByTestId('more-menu-settings').click();
    await expect(page.getByTestId('theme-pref-system')).toBeVisible();

    await page.getByTestId('nav-llm-center').click();
    await page.getByTestId('ping-llm-gateway-btn').first().click();
    await expect(page.getByTestId('llm-ping-result').first()).toBeVisible({ timeout: 20_000 });
  });

  test('4. Ontology Project Hub snapshots, Tiptap bidirectional Markdown & SKILL.md refinement guard, React Flow + ELK/d3-force Knowledge Graph, Registry tables & Unified ShellAgentPanel Session Fork + Reload Persistence', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Projects Home (overview): One-sentence composer + project step status list
    await page.getByTestId('nav-overview').click();
    await expect(page.getByTestId('home-view')).toBeVisible();
    await expect(page.getByTestId('home-project-list')).toBeVisible();
    await expect(page.getByTestId('home-project-step-proj-contract')).toContainText(
      /(业务模型|交付)/,
    );

    // 2. SRS Tiptap Bidirectional Markdown Editor (RICH <-> SOURCE <-> PREVIEW) & Registry switcher (inside Requirements Technical Details)
    await page.getByTestId('enter-active-project-btn').click();
    await page.getByTestId('step-tab-REQUIREMENTS').click();
    await page.getByTestId('requirements-view-mode-toggle').click();
    await page.getByTestId('md-mode-source').click();
    await expect(page.getByTestId('md-source-textarea')).toBeVisible();
    await page.getByTestId('md-mode-preview').click();
    await page.getByTestId('md-mode-rich').click();
    await expect(page.locator('.ProseMirror').first()).toBeVisible();
    await page.getByTestId('srs-mode-registry').click();
    await expect(page.locator('table').first()).toBeVisible();

    // 3. Ontology SKILL.md Custom Refinement + Overwrite Protection ConfirmDialog
    await page.getByTestId('step-tab-DELIVERY').click();
    await page.getByTestId('nav-app-skills').click();
    const compileBtn = page
      .getByRole('button', {
        name: /^(编译当前工程 SKILL\.md|Compile Current Project SKILL\.md)$/,
      })
      .first();
    if ((await page.locator('.ProseMirror').count()) === 0) {
      await compileBtn.click();
    }
    await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('md-mode-source').click();
    const skillSource = page.getByTestId('md-source-textarea');
    const existingMd = await skillSource.inputValue();
    await skillSource.fill(`${existingMd}\n\n## E2E Custom Refinement Guard\n- Verified custom rule\n`);
    await page.getByRole('button', { name: /保存精修版 SKILL\.md|Save Refined SKILL\.md/ }).click();
    await expect(page.locator('.platform-content')).toContainText('已手工精修');
    await compileBtn.click();
    await expect(page.locator('dialog[open]')).toContainText('isCustomRefined');
    await page.locator('dialog[open]').getByRole('button', { name: 'Close dialog' }).click();

    // 4. React Flow v12 + ELK Swimlane + d3-force Ego Focus Knowledge Graph & Data Lineage preset
    await page.getByTestId('step-tab-BUSINESS_MODEL').click();
    await page.getByTestId('open-technical-details-btn').click();
    await page.getByTestId('tech-tab-graph').click();
    await expect(page.getByTestId('kg-root')).toBeVisible();
    await expect(page.locator('.react-flow').first()).toBeVisible();
    await page.getByTestId('kg-mode-ego-btn').click();
    await page.getByTestId('kg-mode-swimlane-btn').click();

    await page.getByTestId('more-menu-btn').click();
    await page.getByTestId('more-menu-analytics').click();
    await page.getByTestId('nav-data-mappings').click();
    await expect(page.locator('.react-flow').first()).toBeVisible();

    // 5. Capability & Analytics Registry Tables + Markdown Editors
    await page.getByTestId('more-menu-btn').click();
    await page.getByTestId('more-menu-capability').click();
    await page.getByTestId('nav-cap-knowledge').click();
    await expect(page.getByTestId('knowledge-markdown-editor')).toBeVisible();
    await page.getByTestId('knowledge-mode-registry-btn').click();
    await expect(page.getByTestId('knowledge-registry-table')).toBeVisible();

    await page.getByTestId('more-menu-btn').click();
    await page.getByTestId('more-menu-analytics').click();
    await page.getByTestId('nav-data-metrics-reports').click();
    await page.getByTestId('reports-mode-editor-btn').click();
    await expect(page.getByTestId('analytics-reports-registry')).toBeVisible();
    await expect(page.getByTestId('analytics-report-markdown-editor')).toBeVisible();

    // 6. Prototype Switcher "另存为新原型" (Save as New Prototype): creates a new InteractivePrototype with its own forked PROTOTYPE_CO_DESIGN session & persists across reload
    await page.getByTestId('back-to-project-btn').click();
    await page.getByTestId('step-tab-PROTOTYPE').click();
    await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible();
    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();

    await page.getByTestId('prototype-switcher-trigger').click();
    await expect(page.getByTestId('prototype-switcher-menu')).toBeVisible();
    await page.getByTestId('prototype-clone-action-btn').click();
    await page.getByTestId('prototype-clone-name-input').fill('合同工作台原型 · 分支方向');
    await page.getByTestId('prototype-clone-confirm-btn').click();

    await expect(page.getByTestId('prototype-switcher-trigger')).toContainText(
      '合同工作台原型 · 分支方向',
      { timeout: 15_000 },
    );
    await expect(agentPanel.getByTestId('agent-panel-fork-badge')).toBeVisible({ timeout: 15_000 });
    await agentPanel.getByTestId('assistant-history-menu-btn').click();
    await expect(page.getByTestId('assistant-history-menu')).toContainText('合同工作台原型 · 分支方向');

    // Reload page and verify cloned prototype + forked multi-prototype history menu persist in SQLite
    await page.reload();
    await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible();
    await page.getByTestId('agent-panel').getByTestId('assistant-history-menu-btn').click();
    await expect(page.getByTestId('assistant-history-menu')).toContainText('合同工作台原型 · 分支方向');
  });

  test('5. New Workbench Shell (#60): 4-step bar & blocked step (>=12px secondary color), More secondary menu, legacy ?mode= URL recovery, and tablet (<1280px) Conversation <-> Canvas toggle', async ({
    page,
  }) => {
    // 1. Legacy URL compatibility on direct navigation & reload recovery
    await page.goto('/?projectId=proj-mft&mode=app-ontology');
    await expect(page.getByTestId('project-selector')).toHaveValue('proj-mft');
    await expect(page.getByTestId('shell-health-status')).toContainText('6 处尚未完成的部分');

    // 2. Blocked step ("还不能开始"): Prototype on proj-mft has no requirements yet -> >= 12px & secondary text color
    const blockedStatus = page.getByTestId('step-status-PROTOTYPE');
    await expect(blockedStatus).toContainText('需先确认需求');
    const styleMetrics = await blockedStatus.evaluate((el) => {
      const cs = getComputedStyle(el);
      const probe = document.createElement('span');
      probe.style.color = 'var(--muted-foreground)';
      document.body.appendChild(probe);
      const mutedColor = getComputedStyle(probe).color;
      probe.style.color = 'var(--faint-foreground)';
      const faintColor = getComputedStyle(probe).color;
      probe.remove();
      return {
        fontSizePx: Number.parseFloat(cs.fontSize),
        color: cs.color,
        mutedColor,
        faintColor,
      };
    });
    expect(styleMetrics.fontSizePx).toBeGreaterThanOrEqual(12);
    expect(styleMetrics.color).toBe(styleMetrics.mutedColor);
    expect(styleMetrics.color).not.toBe(styleMetrics.faintColor);

    // Clicking the blocked step never triggers a modal; renders inline banner & jumps to upstream step
    await page.getByTestId('step-tab-PROTOTYPE').click();
    await expect(page.getByTestId('step-cannot-start-banner')).toBeVisible();
    await page.getByTestId('step-cannot-start-action').click();
    await expect(page.getByTestId('step-tab-REQUIREMENTS')).toHaveAttribute('aria-current', 'step');

    // Switch back to proj-contract and verify "更多" menu opens Governance -> LLM Center
    await page.getByTestId('project-selector').selectOption('proj-contract');
    await page.getByTestId('more-menu-btn').click();
    await page.getByTestId('more-menu-governance').click();
    await expect(page.getByTestId('secondary-area-nav')).toBeVisible();
    await expect(page.getByTestId('ping-llm-gateway-btn').first()).toBeVisible();

    // Verify legacy secondary and step URLs restore cleanly across reload
    await page.goto('/?mode=cap-extraction');
    await expect(page.getByTestId('run-extraction-btn')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('run-extraction-btn')).toBeVisible();

    await page.goto('/?projectId=proj-contract&mode=app-assembly-dev');
    await expect(page.getByTestId('application-development-workflow')).toBeVisible();

    // 3. Tablet viewport (1024x768 < 1280px): Conversation <-> Canvas segmented toggle
    await page.setViewportSize({ width: 1024, height: 768 });
    const paneToggle = page.getByTestId('workspace-pane-toggle');
    await expect(paneToggle).toBeVisible();
    await expect(page.getByTestId('workbench-canvas')).toBeVisible();
    await expect(page.getByTestId('agent-panel')).toBeHidden();

    await page.getByTestId('workspace-pane-conversation').click();
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    await expect(page.getByTestId('workbench-canvas')).toBeHidden();

    await page.getByTestId('workspace-pane-canvas').click();
    await expect(page.getByTestId('workbench-canvas')).toBeVisible();
    await expect(page.getByTestId('agent-panel')).toBeHidden();
  });
});
