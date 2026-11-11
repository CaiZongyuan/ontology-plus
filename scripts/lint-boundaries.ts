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

function resolveImportTarget(fromFile: string, specifier: string, fileSet: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  const fromDir = path.posix.dirname(fromFile);
  const raw = path.posix.normalize(path.posix.join(fromDir, specifier));
  if (fileSet.has(raw)) return raw;
  const stripped = raw.replace(/\.(js|jsx|mjs|cjs)$/, '');
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']) {
    const candidate = `${stripped}${ext}`;
    if (fileSet.has(candidate)) return candidate;
  }
  return raw;
}

function substituteGroup(pattern: string, groups: string[]): string {
  return pattern.replace(/\$(\d+)/g, (_, idx) => groups[Number(idx) - 1] ?? '');
}

function detectCycles(adjacency: Map<string, string[]>, rule: { name: string; severity: string; comment: string }): Violation[] {
  const violations: Violation[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=visited
  const stack: string[] = [];
  const recordedCycles = new Set<string>();

  function dfs(node: string): void {
    state.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 0) {
        dfs(next);
      } else if (nextState === 1) {
        const idx = stack.indexOf(next);
        const cycle = [...stack.slice(idx), next];
        const canonical = [...cycle.slice(0, -1)].sort().join('->');
        if (!recordedCycles.has(canonical)) {
          recordedCycles.add(canonical);
          violations.push({
            ruleName: rule.name,
            severity: rule.severity,
            comment: `${rule.comment} Cycle: ${cycle.join(' -> ')}`,
            from: node,
            to: next,
          });
        }
      }
    }
    stack.pop();
    state.set(node, 2);
  }

  for (const file of adjacency.keys()) {
    if ((state.get(file) ?? 0) === 0) {
      dfs(file);
    }
  }
  return violations;
}

function runBoundaryCheck(): void {
  const rootDir = process.cwd();
  const srcDir = path.join(rootDir, 'src');
  const files = collectTsFiles(srcDir, rootDir);
  const fileSet = new Set(files);
  const violations: Violation[] = [];
  const adjacency = new Map<string, string[]>();

  for (const fromFile of files) {
    const fullPath = path.join(rootDir, fromFile);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const imports = extractImports(content);
    const resolvedTargets: string[] = [];

    for (const spec of imports) {
      const target = resolveImportTarget(fromFile, spec, fileSet);
      if (!target) continue;
      if (fileSet.has(target)) {
        resolvedTargets.push(target);
      }

      for (const rule of config.forbidden ?? []) {
        if (!rule.to?.path) continue;

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

    adjacency.set(fromFile, resolvedTargets);
  }

  const circularRule = (config.forbidden ?? []).find(
    (r: { to?: { circular?: boolean } }) => r.to?.circular === true,
  );
  if (circularRule) {
    violations.push(...detectCycles(adjacency, circularRule));
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
      `✔ Deep-module boundary check passed (${files.length} source files verified, including circular check, 0 violations).`,
    );
  }
}

runBoundaryCheck();
