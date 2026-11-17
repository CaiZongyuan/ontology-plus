import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBuiltInThemesCss, renderContractDoc } from '../src/packages/workbench-theme/index.js';

/**
 * Writes the two files derived from the Workbench Theme tables and contract:
 * the stylesheet the app loads and the contract reference. A test fails when
 * either is out of date.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const outputs: Record<string, string> = {
  'src/web/workbench-themes.generated.css': compileBuiltInThemesCss(),
  'docs/workbench-theme-contract.md': renderContractDoc(),
};

for (const [file, content] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(root, file), content);
  console.log(`wrote ${file}`);
}
