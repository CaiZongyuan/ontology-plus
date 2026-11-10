import { expect, test } from '@playwright/test';

test.describe('Ontology Plus Full-Stack Platform E2E', () => {
  test('renders Spatial-Sync Warm Paper / Film Grain theme, switches zh-CN / en-US, and validates all 11 ontology models', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Verify initial light theme and 11-model validation status
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');

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

    // 4. Navigate across M1, M2, M3, MU, MI in the 11-model workbench
    await page.getByTestId('model-nav-M2').click();
    await expect(page.locator('.workbench-center')).toContainText('BHV-01');
    await page.getByTestId('model-nav-MU').click();
    await expect(page.locator('.workbench-center')).toContainText('SCR-CONTRACT-LIST');
    await page.getByTestId('model-nav-M1').click();

    // 5. Open non-blocking Cascade Rename & Impact Analysis modal and execute atomic rename
    await page.getByTestId('open-cascade-rename-btn').click();
    await page.getByTestId('cascade-rename-new-input').fill('Contract');
    await page.getByTestId('confirm-cascade-rename-btn').click();
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');
  });

  test('executes Application Center workflows: Prototype MU Sync, OWL/Skill/MCP export, and 4-Layer Development Package Compilation', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Prototype Studio -> Save & Extract MU
    await page.getByTestId('nav-app-prototype').click();
    await page.getByTestId('sync-prototype-mu-btn').click();
    await expect(page.getByTestId('toast-banner')).toContainText('MU');

    // 2. Model Files -> Export W3C OWL XML, Generate SKILL.md, Publish MCP Server
    await page.getByTestId('nav-app-model-files').click();
    await page.getByTestId('export-owl-btn').click();
    await expect(page.getByTestId('owl-xml-preview')).toContainText('<owl:Ontology');
    await page.locator('.modal-panel button', { hasText: '✕' }).click();

    await page.getByTestId('generate-skill-btn').click();
    await page.getByTestId('publish-mcp-btn').click();

    // 3. 4-Layer Application Assembly -> Compile Development Package
    await page.getByTestId('nav-app-assembly-dev').click();
    await page.getByTestId('compile-dev-package-btn').click();
    await expect(page.getByTestId('compiled-package-inspector')).toBeVisible();
    await expect(page.getByTestId('compiled-package-inspector')).toContainText('开发指导书.md');
    await expect(page.getByTestId('compiled-package-inspector')).toContainText(
      '本体模型业务功能开发指导书.md',
    );
  });

  test('executes Capability Center (Ontology Extraction & MCP JSON-RPC), Data Analytics Reasoning & Write-Back, and Local Pi LLM Gateway test', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Capability Center: Ontology Extraction (verify "本体萃取" and zero "逆向")
    await page.getByTestId('nav-cap-extraction').click();
    const bodyText = await page.locator('.platform-content').innerText();
    expect(bodyText).toContain('本体萃取');
    expect(bodyText).not.toContain('逆向');
    await page.getByTestId('run-extraction-btn').click();
    await expect(page.getByTestId('toast-banner')).toContainText('本体萃取');

    // 2. Capability Center: Dynamic MCP JSON-RPC 2.0 Tool Call
    await page.getByTestId('nav-cap-mcp').click();
    await page.getByTestId('invoke-mcp-tool-btn').click();
    await expect(page.getByTestId('mcp-rpc-response')).toContainText('"jsonrpc": "2.0"');

    // 3. Data Analytics Center: 3-Stage Reasoning (Ask Data / Why / Policy) & Closed-Loop Write-Back
    await page.getByTestId('nav-data-reasoning').click();
    await page.getByTestId('trigger-policy-writeback-btn').click();
    await expect(page.getByTestId('toast-banner')).toContainText('WB-01');

    // 4. LLM Center: Ping Local Pi Gateway (http://127.0.0.1:3425/v1 · auto/glm-5.3-flash)
    await page.getByTestId('nav-llm-center').click();
    await page.getByTestId('ping-llm-gateway-btn').click();
    await expect(page.getByTestId('llm-ping-result')).toBeVisible({ timeout: 20_000 });
  });
});

