import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const webRoot = path.join(repoRoot, 'src/web');

describe('component markup', () => {
  // Colour utilities written with a pre-contract name, and the contract name that paints
  // the same colour. Names without a contract token (`hover-2`, `line-strong`) are not here.
  const contractNameFor: Record<string, string> = {
    page: 'background',
    surface: 'card',
    inset: 'muted',
    field: 'muted',
    ink: 'foreground',
    'ink-2': 'foreground-soft',
    'ink-3': 'faint-foreground',
    hover: 'accent',
    line: 'border',
    green: 'success',
    'green-tint': 'success-soft',
    orange: 'warning',
    'orange-tint': 'warning-soft',
    red: 'destructive',
    'red-tint': 'destructive-soft',
  };
  const skipped = new Set([
    // Example CSS for generated prototypes, which define their own palette.
    'components/prototype/motionSchematicSpecs.ts',
  ]);
  const prefixes =
    'bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|decoration|placeholder|caret|shadow';
  const oldNames = Object.keys(contractNameFor)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const oldUtility = new RegExp(`(?<![\\w$.-])(${prefixes})-(${oldNames})(?![\\w-])`, 'g');

  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });

  it('writes colour utilities with contract names', () => {
    const found: string[] = [];
    for (const file of sources(webRoot)) {
      const relative = path.relative(webRoot, file).split(path.sep).join('/');
      if (skipped.has(relative)) continue;
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const [utility, prefix, oldName] of line.matchAll(oldUtility)) {
            found.push(`src/web/${relative}:${index + 1}: ${utility} -> ${prefix}-${contractNameFor[oldName!]}`);
          }
        });
    }
    expect(found, found.join('\n')).toEqual([]);
  });
});
