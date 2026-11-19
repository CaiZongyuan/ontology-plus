/**
 * Server-side artboard screenshotter for prototype visual review (#93).
 *
 * In Node environments where Playwright Chromium is available, renders a completed screen at
 * canvas artboard dimensions (1280 × 860) inside an isolated browser context with external
 * network requests blocked, and returns a transient PNG image buffer. In edge runtimes
 * (Cloudflare Workers) or environments without a browser binary, `available()` returns `false`
 * so the engine skips visual review honestly without failing the build.
 */

import { composeArtboardBody, splitPrototypeDocument } from '../../ontology-core/index.js';

export const PROTOTYPE_ARTBOARD_WIDTH = 1280;
export const PROTOTYPE_ARTBOARD_HEIGHT = 860;

export interface PrototypeScreenCapture {
  mimeType: 'image/png' | 'image/webp';
  dataBase64: string;
  width: number;
  height: number;
}

export interface PrototypeCaptureInput {
  documentHtml: string;
  screenId: string;
  width?: number;
  height?: number;
  signal?: AbortSignal;
}

export interface PrototypeScreenshotter {
  available(): Promise<boolean> | boolean;
  /** Ensures Playwright & headless Chromium actually launch before emitting `review_started` (#93). */
  warmup?(): Promise<boolean>;
  captureScreen(input: PrototypeCaptureInput): Promise<PrototypeScreenCapture | null>;
  shutdown?(): Promise<void>;
}

export interface PrototypeScreenshotterOptions {
  /** Override browser executable lookup (returning null simulates no browser available). */
  resolveExecutablePath?: () => Promise<string | null> | string | null;
  /** Max concurrent pages open at once on the shared browser. */
  maxConcurrent?: number;
  /** Close the shared headless Chromium after being idle this long (ms). */
  idleCloseMs?: number;
  /** Hard deadline for one screenshot capture (ms). */
  renderTimeoutMs?: number;
}

interface PlaywrightBrowserLike {
  isConnected(): boolean;
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
  }): Promise<PlaywrightContextLike>;
  close(): Promise<void>;
}

interface PlaywrightContextLike {
  route(
    url: string,
    handler: (route: {
      request(): { url(): string };
      continue(): Promise<void>;
      abort(): Promise<void>;
    }) => Promise<void> | void,
  ): Promise<void>;
  newPage(): Promise<PlaywrightPageLike>;
  close(): Promise<void>;
}

interface PlaywrightPageLike {
  setContent(html: string, options?: { waitUntil?: 'load' | 'domcontentloaded'; timeout?: number }): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  screenshot(options?: {
    type?: 'png' | 'jpeg';
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Uint8Array>;
}

function isNodeRuntime(): boolean {
  return (
    typeof process !== 'undefined' &&
    Boolean(process.versions?.node) &&
    process.env.ONTOLOGY_DISABLE_PROTOTYPE_SCREENSHOT !== '1'
  );
}

/** Dynamic import via variable specifier so edge bundlers (Cloudflare Workers) never bundle Node/Playwright. */
function dynamicImport<T>(specifier: string): Promise<T> {
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}

async function discoverChromiumExecutable(): Promise<string | null> {
  if (!isNodeRuntime()) return null;
  try {
    // Playwright's chromium launcher itself must be importable; a lone system browser without
    // Playwright cannot capture screenshots and must report unavailable (`false`).
    const pw = await dynamicImport<{
      chromium?: { launch?: unknown; executablePath?: () => string };
    }>('@playwright/test').catch(() => null);
    if (!pw?.chromium || typeof pw.chromium.launch !== 'function') return null;

    const fs = await dynamicImport<typeof import('node:fs')>('node:fs');
    const os = await dynamicImport<typeof import('node:os')>('node:os');
    const path = await dynamicImport<typeof import('node:path')>('node:path');

    const existsExec = (candidate: string | undefined): candidate is string => {
      if (!candidate?.trim()) return false;
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return fs.existsSync(candidate);
      }
    };

    for (const envVar of [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, process.env.CHROME_PATH]) {
      if (existsExec(envVar)) return envVar;
    }

    const defaultExec = pw.chromium.executablePath?.();
    if (existsExec(defaultExec)) return defaultExec;

    const cacheRoots = [
      path.join(os.homedir(), '.cache', 'ms-playwright'),
      path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : '',
    ].filter(Boolean);

    for (const cacheDir of cacheRoots) {
      if (!fs.existsSync(cacheDir)) continue;
      const dirs = fs
        .readdirSync(cacheDir)
        .filter((d) => d.startsWith('chromium-') || d.startsWith('chromium_headless_shell-'))
        .sort()
        .reverse();
      for (const dir of dirs) {
        const subCandidates = [
          path.join(cacheDir, dir, 'chrome-linux64', 'chrome'),
          path.join(cacheDir, dir, 'chrome-linux', 'chrome'),
          path.join(cacheDir, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
          path.join(cacheDir, dir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          path.join(cacheDir, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          path.join(cacheDir, dir, 'chrome-win', 'chrome.exe'),
        ];
        for (const sub of subCandidates) {
          if (existsExec(sub)) return sub;
        }
      }
    }

    const systemCandidates = [
      '/opt/microsoft/msedge/msedge',
      '/usr/bin/microsoft-edge',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const sys of systemCandidates) {
      if (existsExec(sys)) return sys;
    }
  } catch {
    return null;
  }
  return null;
}

/** Composes the standalone HTML rendered on one 1280 × 860 artboard for `screenId`. */
export function composeArtboardDocumentForScreenshot(documentHtml: string, screenId: string): string | null {
  const sid = screenId.trim();
  if (!sid || !documentHtml.trim()) return null;
  const { frame, screens } = splitPrototypeDocument(documentHtml);
  const target = screens.find((s) => s.screenId === sid);
  if (!target || !target.html.trim()) return null;
  const bodyInner = composeArtboardBody(frame, sid, target.html);
  const runtimeStyle = `<style data-onto-screenshot-runtime>[data-screen-id]{display:block!important;visibility:visible!important;opacity:1!important}</style>`;
  const escapedJsSid = JSON.stringify(sid);
  const activeNavScript = `<script>(function(){var secs=document.querySelectorAll('[data-screen-id]');for(var s=0;s<secs.length;s++){secs[s].classList.toggle('is-active',secs[s].getAttribute('data-screen-id')===${escapedJsSid});}var tabs=document.querySelectorAll('[data-nav-screen]');for(var i=0;i<tabs.length;i++){tabs[i].classList.toggle('is-active',tabs[i].getAttribute('data-nav-screen')===${escapedJsSid});}})();</script>`;
  return `<!DOCTYPE html>\n<html${frame.htmlAttrs}>\n<head>${frame.headHtml}\n${runtimeStyle}</head>\n<body${frame.bodyAttrs}>${bodyInner}\n${activeNavScript}</body>\n</html>`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const activeShutdownCallbacks = new Set<() => Promise<void>>();
let exitHooksInstalled = false;

function registerProcessExitCleanup(fn: () => Promise<void>): () => void {
  activeShutdownCallbacks.add(fn);
  if (!exitHooksInstalled && typeof process !== 'undefined' && typeof process.once === 'function') {
    exitHooksInstalled = true;
    const closeAll = () => {
      for (const cb of activeShutdownCallbacks) {
        void cb().catch(() => undefined);
      }
    };
    process.once('beforeExit', closeAll);
  }
  return () => {
    activeShutdownCallbacks.delete(fn);
  };
}

export function createPrototypeScreenshotter(
  options: PrototypeScreenshotterOptions = {},
): PrototypeScreenshotter & { shutdown(): Promise<void> } {
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 3);
  const idleCloseMs = options.idleCloseMs ?? 1_200;
  const renderTimeoutMs = options.renderTimeoutMs ?? 15_000;
  const resolveExec = options.resolveExecutablePath ?? discoverChromiumExecutable;

  let browserPromise: Promise<PlaywrightBrowserLike> | null = null;
  let resolvedBrowser: PlaywrightBrowserLike | null = null;
  let browserLaunchFailed = false;
  let activePages = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const waiters: (() => void)[] = [];

  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const closeBrowserNow = async (): Promise<void> => {
    clearIdle();
    const pending = browserPromise;
    const live = resolvedBrowser;
    browserPromise = null;
    resolvedBrowser = null;
    const target = live ?? (pending ? await pending.catch(() => null) : null);
    if (target) {
      await withTimeout(target.close(), 4_000, 'closing screenshot browser').catch(() => undefined);
    }
  };

  const unregisterCleanup = registerProcessExitCleanup(closeBrowserNow);

  const scheduleIdleClose = () => {
    clearIdle();
    if (activePages > 0 || !browserPromise) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (activePages === 0) void closeBrowserNow();
    }, idleCloseMs);
    idleTimer.unref?.();
  };

  const acquireSlot = (): Promise<() => void> => {
    const take = (): (() => void) => {
      activePages += 1;
      clearIdle();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activePages -= 1;
        const next = waiters.shift();
        if (next) next();
        else scheduleIdleClose();
      };
    };
    if (activePages < maxConcurrent) return Promise.resolve(take());
    return new Promise((resolve) => {
      waiters.push(() => resolve(take()));
    });
  };

  const ensureBrowser = async (): Promise<PlaywrightBrowserLike | null> => {
    if (browserLaunchFailed) return null;
    if (resolvedBrowser && !resolvedBrowser.isConnected()) {
      await closeBrowserNow();
    }
    if (!browserPromise) {
      const execPath = await Promise.resolve(resolveExec()).catch(() => null);
      if (!execPath) return null;
      browserPromise = (async () => {
        const pw = await dynamicImport<{
          chromium: {
            launch(opts: { executablePath: string; headless: boolean; args: string[] }): Promise<PlaywrightBrowserLike>;
          };
        }>('@playwright/test');
        const linuxSandboxArgs =
          typeof process !== 'undefined' && process.platform === 'linux'
            ? ['--no-sandbox', '--disable-setuid-sandbox']
            : [];
        const launched = await pw.chromium.launch({
          executablePath: execPath,
          headless: true,
          args: [
            '--no-first-run',
            '--disable-extensions',
            '--hide-scrollbars',
            '--disable-dev-shm-usage',
            ...linuxSandboxArgs,
          ],
        });
        resolvedBrowser = launched;
        return launched;
      })();
      browserPromise.catch(() => {
        browserPromise = null;
        resolvedBrowser = null;
        browserLaunchFailed = true;
      });
    }
    return browserPromise.catch(() => null);
  };

  return {
    async available(): Promise<boolean> {
      if (browserLaunchFailed) return false;
      if (!isNodeRuntime() && !options.resolveExecutablePath) return false;
      const execPath = await Promise.resolve(resolveExec()).catch(() => null);
      return Boolean(execPath);
    },

    async warmup(): Promise<boolean> {
      if (browserLaunchFailed) return false;
      if (!isNodeRuntime() && !options.resolveExecutablePath) return false;
      const browser = await ensureBrowser();
      scheduleIdleClose();
      return Boolean(browser);
    },

    async captureScreen(input: PrototypeCaptureInput): Promise<PrototypeScreenCapture | null> {
      if (input.signal?.aborted) return null;
      const html = composeArtboardDocumentForScreenshot(input.documentHtml, input.screenId);
      if (!html) return null;
      const width = Math.max(320, Math.round(input.width ?? PROTOTYPE_ARTBOARD_WIDTH));
      const height = Math.max(240, Math.round(input.height ?? PROTOTYPE_ARTBOARD_HEIGHT));

      const release = await acquireSlot();
      let context: PlaywrightContextLike | null = null;
      try {
        const browser = await ensureBrowser();
        if (!browser || input.signal?.aborted) return null;

        return await withTimeout(
          (async () => {
            context = await browser.newContext({
              viewport: { width, height },
              deviceScaleFactor: 1,
            });
            await context.route('**/*', (route) => {
              const url = route.request().url();
              if (/^(?:about:|data:|blob:)/i.test(url)) {
                return route.continue();
              }
              return route.abort();
            });
            const page = await context.newPage();
            await page
              .setContent(html, { waitUntil: 'domcontentloaded', timeout: 8_000 })
              .catch(() => undefined);
            await new Promise((r) => setTimeout(r, 60));
            const bytes = await page.screenshot({
              type: 'png',
              clip: { x: 0, y: 0, width, height },
            });
            return {
              mimeType: 'image/png' as const,
              dataBase64: Buffer.from(bytes).toString('base64'),
              width,
              height,
            };
          })(),
          renderTimeoutMs,
          `capturing artboard screenshot for ${input.screenId}`,
        );
      } catch {
        return null;
      } finally {
        if (context) {
          await withTimeout((context as PlaywrightContextLike).close(), 3_000, 'closing screenshot context').catch(
            () => undefined,
          );
        }
        release();
      }
    },

    async shutdown(): Promise<void> {
      unregisterCleanup();
      await closeBrowserNow();
    },
  };
}

export const defaultPrototypeScreenshotter = createPrototypeScreenshotter();

/** Closes all shared headless Chromium instances started for prototype screenshots. */
export async function shutdownPrototypeScreenshotter(): Promise<void> {
  const callbacks = [...activeShutdownCallbacks];
  await Promise.all(callbacks.map((cb) => cb().catch(() => undefined)));
}
