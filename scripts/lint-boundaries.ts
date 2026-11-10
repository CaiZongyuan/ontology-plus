import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../.dependency-cruiser.cjs');

interface Violation {
  ruleName: string;
  severity: string;
  comment: string;
  from: string;
  to: string;
}

function collectTsFiles(dir: string, rootDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath, rootDir));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      results.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return results;
}

function extractImports(fileContent: string): string[] {
  const specs: string[] = [];
  const regex =
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(fileContent)) !== null) {
    const spec = match[1] || match[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

function resolveImportTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const fromDir = path.posix.dirname(fromFile);
  return path.posix.normalize(path.posix.join(fromDir, specifier));
}

function substituteGroup(pattern: string, groups: string[]): string {
  return pattern.replace(/\$(\d+)/g, (_, idx) => groups[Number(idx) - 1] ?? '');
}

function runBoundaryCheck(): void {
  const rootDir = process.cwd();
  const srcDir = path.join(rootDir, 'src');
  const files = collectTsFiles(srcDir, rootDir);
  const violations: Violation[] = [];

  for (const fromFile of files) {
    const fullPath = path.join(rootDir, fromFile);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const imports = extractImports(content);

    for (const spec of imports) {
      const target = resolveImportTarget(fromFile, spec);
      if (!target) continue;

      for (const rule of config.forbidden ?? []) {
        if (!rule.to?.path) continue; // skip circular-only rule here

        let groups: string[] = [];
        if (rule.from?.path) {
          const fromMatch = fromFile.match(new RegExp(rule.from.path));
          if (!fromMatch) continue;
          groups = fromMatch.slice(1);
        }
        if (rule.from?.pathNot) {
          const fromNotPattern = substituteGroup(rule.from.pathNot, groups);
          if (new RegExp(fromNotPattern).test(fromFile)) continue;
        }

        const toPattern = substituteGroup(rule.to.path, groups);
        if (!new RegExp(toPattern).test(target)) continue;

        if (rule.to?.pathNot) {
          const toNotPattern = substituteGroup(rule.to.pathNot, groups);
          if (new RegExp(toNotPattern).test(target)) continue;
        }

        violations.push({
          ruleName: rule.name,
          severity: rule.severity,
          comment: rule.comment,
          from: fromFile,
          to: target,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n✖ ${violations.length} deep-module boundary violation(s) found:\n`);
    for (const v of violations) {
      console.error(`  [${v.severity.toUpperCase()}] ${v.ruleName}: ${v.from} -> ${v.to}`);
      console.error(`    ${v.comment}\n`);
    }
    process.exit(1);
  } else {
    console.log(
      `✔ Deep-module boundary check passed (${files.length} source files verified, 0 violations).`,
    );
  }
}

runBoundaryCheck();

