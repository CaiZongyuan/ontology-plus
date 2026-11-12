import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.PLAYWRIGHT_PORT ?? 4319);
const e2eWorkspaceRoot =
  process.env.ONTOLOGY_E2E_WORKSPACE_ROOT ||
  fs.mkdtempSync(path.join(os.tmpdir(), 'onto-e2e-'));
process.env.ONTOLOGY_E2E_WORKSPACE_ROOT = e2eWorkspaceRoot;

const explicitChannel = process.env.PLAYWRIGHT_CHANNEL?.trim();
const hasSystemEdge =
  fs.existsSync('/opt/microsoft/msedge/msedge') ||
  fs.existsSync('/usr/bin/microsoft-edge');
const browserChannel = explicitChannel || (hasSystemEdge ? 'msedge' : undefined);

function resolveCachedChromiumExecutable(): string | undefined {
  if (browserChannel) return undefined;
  try {
    const defaultExec = chromium.executablePath();
    if (defaultExec && fs.existsSync(defaultExec)) {
      return undefined;
    }
    const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (!fs.existsSync(cacheDir)) return undefined;
    const dirs = fs
      .readdirSync(cacheDir)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const candidate = path.join(cacheDir, dir, 'chrome-linux64', 'chrome');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const fallbackExecutablePath = resolveCachedChromiumExecutable();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    viewport: { width: 1440, height: 900 },
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: browserChannel
        ? { ...devices['Desktop Edge'], channel: browserChannel, viewport: { width: 1440, height: 900 } }
        : {
            ...devices['Desktop Chrome'],
            viewport: { width: 1440, height: 900 },
            ...(fallbackExecutablePath
              ? { launchOptions: { executablePath: fallbackExecutablePath } }
              : {}),
          },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: `http://127.0.0.1:${e2ePort}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: String(e2ePort),
      ONTOLOGY_WORKSPACE_ROOT: e2eWorkspaceRoot,
      ONTOLOGY_MOCK_LLM: '1',
    },
  },
});
