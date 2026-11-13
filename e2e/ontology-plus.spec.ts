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

    // 1. Verify initial light theme, validation status, and Unified ShellAgentPanel docked column
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');
    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();
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
    await expect(page.getByTestId('nav-app-ontology')).toContainText('11-Model Ontology');
    await page.getByTestId('locale-toggle-btn').click();
    await expect(page.getByTestId('nav-app-ontology')).toContainText('业务本体');

    // 4. Navigate across M1, M2, MU in the 11-model workbench & Quick-Add with Undo/Redo
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
    await page.getByTestId('nav-app-knowledge-graph').click();
    await expect(page.getByTestId('kg-edge-filter')).toBeVisible();
    await page.getByTestId('kg-zoom-in-btn').click();

    // 6. Return to Ontology Workbench -> Open non-blocking Cascade Rename & Impact Analysis modal
    await page.getByTestId('nav-app-ontology').click();
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
    await page.getByTestId('nav-app-req-explore').click();
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

    // 2. Prototype Co-Design Studio -> Briefing/Canvas toggle, localized refinement in ShellAgentPanel & Confirm This Revision -> MU sync
    await page.getByTestId('nav-app-prototype').click();
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
    await expect(page.getByTestId('toast-banner')).toContainText('MU');

    // 3. AI Ontology Copilot via Unified ShellAgentPanel -> Execute tool mutation
    await page.getByTestId('nav-app-ontology').click();
    await expect(agentPanel).toBeVisible();
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('请新增一条超额采购合同双重风控校验规则');
    await page.getByTestId('agent-panel-send-btn').click();
    await expect(agentPanel.locator('[data-tool-name="upsert_rule"]').first()).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');

    // 4. Model Files -> Export W3C OWL XML, Generate SKILL.md, Publish MCP Server
    await page.getByTestId('nav-app-model-files').click();
    await page.getByTestId('export-owl-btn').click();
    await expect(page.getByTestId('owl-xml-preview')).toContainText('<owl:Ontology');
    await page.locator('.modal-panel button', { hasText: '✕' }).click();

    await page.getByTestId('generate-skill-btn').click();
    await page.getByTestId('publish-mcp-btn').click();

    // 5. 4-Layer Application Assembly -> Coding Agent context + Compile Development Package & verify ZIP endpoint
    await page.getByTestId('nav-app-assembly-dev').click();
    await expect(page.getByTestId('coding-agent-context-card')).toBeVisible();
    await expect(agentPanel).toBeVisible();
    await page.getByTestId('compile-dev-package-btn').click();
    await expect(page.getByTestId('compiled-package-inspector')).toBeVisible();
    await expect(page.getByTestId('compiled-package-inspector')).toContainText('开发指导书.md');
    await expect(page.getByTestId('compiled-package-inspector')).toContainText(
      '本体模型业务功能开发指导书.md',
    );
    await expect(page.getByTestId('download-package-zip-btn')).toBeVisible();
  });

  test('3. Capability Center (Ontology Extraction, MCP JSON-RPC, Smart Chat via ShellAgentPanel), Data Analytics (Live SQL, 3-Stage Reasoning & Write-Back via ShellAgentPanel), and Local Pi LLM Gateway', async ({
    page,
  }) => {
    await page.goto('/');

    const agentPanel = page.getByTestId('agent-panel');

    // 1. Capability Center: Ontology Extraction via Unified ShellAgentPanel (verify "本体萃取" and zero "逆向")
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

    // 4. Data Analytics Center: Live Read-Only SQL Sandbox Preview
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

    // 6. System Settings 3-state theme control & LLM Center Local Pi Gateway test
    await page.getByTestId('nav-system-settings').click();
    await expect(page.getByTestId('theme-pref-system')).toBeVisible();

    await page.getByTestId('nav-llm-center').click();
    await page.getByTestId('ping-llm-gateway-btn').first().click();
    await expect(page.getByTestId('llm-ping-result').first()).toBeVisible({ timeout: 20_000 });
  });

  test('4. Ontology Project Hub snapshots, Tiptap bidirectional Markdown & SKILL.md refinement guard, React Flow + ELK/d3-force Knowledge Graph, Registry tables & Unified ShellAgentPanel Session Fork + Reload Persistence', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Ontology Project Hub (overview): Registry table + non-blocking Milestone Snapshot manager
    await page.getByTestId('nav-overview').click();
    await expect(page.getByTestId('project-hub-registry')).toBeVisible();
    await page.getByTestId('project-snapshots-btn-proj-contract').click();
    const openDialog = page.locator('dialog[open]');
    await expect(openDialog).toBeVisible();
    await openDialog.getByPlaceholder(/快照版本标签|Snapshot label/).fill('v5.3 E2E Baseline');
    await page.getByTestId('create-snapshot-confirm-btn').click();
    await expect(openDialog).toContainText('v5.3 E2E Baseline');
    await openDialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(openDialog).toBeHidden();

    // 2. SRS Tiptap Bidirectional Markdown Editor (RICH <-> SOURCE <-> PREVIEW) & Registry switcher
    await page.getByTestId('nav-app-req-docs').click();
    await page.getByTestId('md-mode-source').click();
    await expect(page.getByTestId('md-source-textarea')).toBeVisible();
    await page.getByTestId('md-mode-preview').click();
    await page.getByTestId('md-mode-rich').click();
    await expect(page.locator('.ProseMirror').first()).toBeVisible();
    await page.getByTestId('srs-mode-registry').click();
    await expect(page.locator('table').first()).toBeVisible();

    // 3. Ontology SKILL.md Custom Refinement + Overwrite Protection ConfirmDialog
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
    await page.getByTestId('nav-app-knowledge-graph').click();
    await expect(page.getByTestId('kg-root')).toBeVisible();
    await expect(page.locator('.react-flow').first()).toBeVisible();
    await page.getByTestId('kg-mode-ego-btn').click();
    await page.getByTestId('kg-mode-swimlane-btn').click();

    await page.getByTestId('nav-data-mappings').click();
    await expect(page.locator('.react-flow').first()).toBeVisible();

    // 5. Capability & Analytics Registry Tables + Markdown Editors
    await page.getByTestId('nav-cap-knowledge').click();
    await expect(page.getByTestId('knowledge-markdown-editor')).toBeVisible();
    await page.getByTestId('knowledge-mode-registry-btn').click();
    await expect(page.getByTestId('knowledge-registry-table')).toBeVisible();

    await page.getByTestId('nav-data-metrics-reports').click();
    await page.getByTestId('reports-mode-editor-btn').click();
    await expect(page.getByTestId('analytics-reports-registry')).toBeVisible();
    await expect(page.getByTestId('analytics-report-markdown-editor')).toBeVisible();

    // 6. Prototype Switcher "另存为新原型" (Save as New Prototype): creates a new InteractivePrototype with its own forked PROTOTYPE_CO_DESIGN session & persists across reload
    await page.getByTestId('nav-app-prototype').click();
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
    await expect(agentPanel.getByTestId('agent-panel-session-select')).toBeVisible();

    // Reload page and verify cloned prototype + forked multi-prototype session selector persist in SQLite
    await page.reload();
    await page.getByTestId('nav-app-prototype').click();
    await expect(page.getByTestId('agent-panel').getByTestId('agent-panel-session-select')).toBeVisible();
  });
});
