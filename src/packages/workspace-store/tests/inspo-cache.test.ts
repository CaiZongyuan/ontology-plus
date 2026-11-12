import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURATED_INSPO_CATALOG,
  createWorkspaceStore,
  deriveSourceSiteFromSlug,
  normalizeVisualReferenceItem,
  type VisualReferenceItem,
} from '../index.js';

const tempDirs: string[] = [];

function createIsolatedDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-inspo-cache-'));
  tempDirs.push(dir);
  return path.join(dir, 'test.db');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('workspace-store Inspo reference catalog & durable cache', () => {
  it('enriches curated catalog items and slug derivation with sourceDomain, sourceUrl, and remote CDN URLs', () => {
    expect(CURATED_INSPO_CATALOG.length).toBeGreaterThanOrEqual(12);

    const increase = CURATED_INSPO_CATALOG.find((item) => item.slug === 'increase-com');
    expect(increase).toBeDefined();
    expect(increase?.sourceDomain).toBe('increase.com');
    expect(increase?.sourceUrl).toBe('https://increase.com');
    expect(increase?.heroUrl).toBe(
      'https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures/increase-com/hero.1440.webp',
    );
    expect(increase?.fullPageUrl).toBe(
      'https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures/increase-com/full.1440.webp',
    );
    expect(increase?.thumbUrl).toBe(
      'https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures/increase-com/thumb.384.webp',
    );
    expect(increase?.mobileUrl).toBe(
      'https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures/increase-com/mobile.384.webp',
    );

    const amie = CURATED_INSPO_CATALOG.find((item) => item.slug === 'amie-so');
    expect(amie?.sourceDomain).toBe('amie.so');
    expect(amie?.sourceUrl).toBe('https://amie.so');

    expect(deriveSourceSiteFromSlug('polar-sh--pricing')).toEqual({
      sourceDomain: 'polar.sh',
      sourceUrl: 'https://polar.sh',
    });
    expect(
      deriveSourceSiteFromSlug('linear-app--features', 'https://www.linear.app/features'),
    ).toEqual({
      sourceDomain: 'linear.app',
      sourceUrl: 'https://www.linear.app/features',
    });
  });

  it('persists search, recommend, and design_system cache entries across reopened SQLite stores', () => {
    const dbPath = createIsolatedDbPath();
    const storeA = createWorkspaceStore({ dbPath, enableFileMirror: false });

    expect(storeA.getInspoCache('inspo:recommend:fintech:light')).toBeUndefined();

    const normalizedItem = normalizeVisualReferenceItem({
      slug: 'mercury-com--treasury',
      title: 'Mercury Treasury',
      northstar: 'Calm banking precision',
      palette: ['#272735', '#5266eb'],
      fonts: ['Inter'],
      mode: 'light',
      macro: 'index-first',
      tags: 'fintech, banking',
    });

    storeA.saveInspoCache({
      cacheKey: 'inspo:recommend:fintech:light',
      action: 'recommend',
      items: [normalizedItem],
      pick: {
        macrostructure: { slug: 'index-first', label: 'Index-First' },
        rationale: 'Dense financial operations fit index-first hierarchy.',
      },
    });

    storeA.saveInspoCache({
      cacheKey: 'inspo:design_system:mercury-com--treasury',
      action: 'design_system',
      slug: 'mercury-com--treasury',
      markdown: '# Mercury Design System\n\n- Primary: `#5266eb`',
    });

    // Reopen a brand new store instance on the same SQLite database file
    const storeB = createWorkspaceStore({ dbPath, enableFileMirror: false });

    const recHit = storeB.getInspoCache('inspo:recommend:fintech:light');
    expect(recHit).toBeDefined();
    expect(recHit?.action).toBe('recommend');
    expect(recHit?.items).toHaveLength(1);
    expect(recHit?.items?.[0]?.slug).toBe('mercury-com--treasury');
    expect(recHit?.items?.[0]?.sourceDomain).toBe('mercury.com');
    expect(recHit?.items?.[0]?.sourceUrl).toBe('https://mercury.com');
    expect(recHit?.pick?.macrostructure?.slug).toBe('index-first');

    const mdHit = storeB.getInspoCache('inspo:design_system:mercury-com--treasury');
    expect(mdHit).toBeDefined();
    expect(mdHit?.markdown).toContain('# Mercury Design System');
  });

  it('never persists data: base64 image URIs or binary image fields in inspo_cache', () => {
    const dbPath = createIsolatedDbPath();
    const store = createWorkspaceStore({ dbPath, enableFileMirror: false });

    const base64Attempt = {
      ...CURATED_INSPO_CATALOG[0]!,
      slug: 'custom-ref-io',
      heroUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
      fullPageUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4',
      thumbUrl: 'javascript:alert(1)',
      sourceUrl: 'data:text/html;base64,PHNjcmlwdD4=',
      imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAUA',
    } as VisualReferenceItem & { imageBase64?: string };

    store.saveInspoCache({
      cacheKey: 'inspo:search:sanitize-test',
      action: 'search',
      items: [base64Attempt],
    });

    const saved = store.getInspoCache('inspo:search:sanitize-test');
    expect(saved).toBeDefined();
    const item = saved?.items?.[0];
    expect(item).toBeDefined();
    expect(item?.heroUrl).toBe(
      'https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures/custom-ref-io/hero.1440.webp',
    );
    expect(item?.fullPageUrl).toBe(
      'https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures/custom-ref-io/full.1440.webp',
    );
    expect(item?.thumbUrl).toBe(
      'https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures/custom-ref-io/thumb.384.webp',
    );
    expect(item?.sourceUrl).toBe('https://custom-ref.io');
    expect(JSON.stringify(saved)).not.toContain('data:image');
    expect(JSON.stringify(saved)).not.toContain('iVBORw0KGgo');
  });
});
