import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkWorkbenchSources, formatAppearanceProblems, type SourceFile } from '../src/packages/workbench-theme/index.js';

/**
 * The appearance guard over the workbench sources (ADR 0012): styles and components read
 * only Workbench Theme contract tokens and the registered shared derived variables, and
 * paint no literal colours outside the registered places. Part of `pnpm check`.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir: string): SourceFile[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(full);
    if (!/\.(css|tsx?)$/.test(entry.name)) return [];
    return [{ path: path.relative(root, full).split(path.sep).join('/'), content: fs.readFileSync(full, 'utf8') }];
  });
}

const problems = checkWorkbenchSources(collect(path.join(root, 'src/web')));
if (problems.length > 0) {
  console.error(formatAppearanceProblems(problems));
  console.error(
    `\n${problems.length} appearance problem(s). Components read only Workbench Theme tokens: see docs/workbench-theme-contract.md.`,
  );
  process.exit(1);
}
console.log('lint:theme: workbench styles and components read only contract tokens and shared derived variables.');
