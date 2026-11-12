import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

const port = Number(process.env.PORT ?? 4310);
const store = createWorkspaceStore();
const app = createApiApp(store);

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));

// Serve built frontend assets in production/start mode if dist/client exists
const distDir = path.resolve(process.cwd(), 'dist', 'client');
if (fs.existsSync(distDir)) {
  app.get('*', (c) => {
    const reqPath = c.req.path === '/' ? '/index.html' : c.req.path;
    const candidate = path.resolve(distDir, `.${reqPath}`);
    const isInsideDist =
      candidate === distDir || candidate.startsWith(`${distDir}${path.sep}`);

    if (isInsideDist && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      };
      const body = fs.readFileSync(candidate);
      return new Response(body, {
        headers: {
          'Content-Type': mimeMap[ext] ?? 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
        },
      });
    }
    const indexHtml = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return c.html(fs.readFileSync(indexHtml, 'utf-8'));
    }
    return c.notFound();
  });
}

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`Ontology Plus API Server listening on http://127.0.0.1:${info.port}`);
});
