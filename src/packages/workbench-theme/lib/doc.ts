import { CONTRAST_PAIRS, DERIVED_VARIABLES, THEME_CONTRACT_VERSION, THEME_TOKENS, THEME_TOKEN_GROUPS, cssVarName, type ThemeTokenGroup } from './contract.js';

/** The contract reference, generated so it cannot drift from the token list. */
export function renderContractDoc(): string {
  const lines: string[] = [
    '# Workbench Theme contract',
    '',
    '<!-- Generated from src/packages/workbench-theme by `pnpm themes:generate`. Do not edit by hand. -->',
    '',
    `Contract version: ${THEME_CONTRACT_VERSION}`,
    '',
    'A Workbench Theme is a table of values for the tokens below, one column for light and one for dark (ADR 0012). Components read only these tokens. A theme may not change layout, spacing or density, the type-size scale, component structure, motion, or copy.',
    '',
    'A token marked "follows" takes the value of another token when a theme leaves it unset. Renaming or removing a token breaks themes and bumps the contract version.',
    '',
  ];
  for (const group of Object.keys(THEME_TOKEN_GROUPS) as ThemeTokenGroup[]) {
    lines.push(`## ${THEME_TOKEN_GROUPS[group]}`, '', '| Token | CSS variable | Meaning | Follows |', '| --- | --- | --- | --- |');
    for (const spec of THEME_TOKENS.filter((token) => token.group === group)) {
      const follows = spec.fallback ? `\`${spec.fallback}\`` : '';
      lines.push(`| \`${spec.name}\` | \`${cssVarName(spec.name)}\` | ${spec.description} | ${follows} |`);
    }
    lines.push('');
  }
  lines.push(
    '## Contrast',
    '',
    'Every built-in theme is checked in both modes. Text must reach 4.5:1 and marks 3:1 on the surfaces they are used on. A translucent surface is measured painted over the surface named after "over".',
    '',
    '| Token | On | Minimum |',
    '| --- | --- | --- |',
  );
  for (const pair of CONTRAST_PAIRS) {
    const on = pair.over ? `\`${pair.on}\` over \`${pair.over}\`` : `\`${pair.on}\``;
    lines.push(`| \`${pair.text}\` | ${on} | ${pair.min}:1 |`);
  }
  lines.push(
    '',
    '## Shared derived variables',
    '',
    'These are computed from contract tokens and are the same for every theme, so a theme author does not fill them: they follow the tokens they are made of. Components may read them as they read contract tokens, so their names are part of the contract: renaming or removing one breaks components and bumps the contract version, as it does for a token. Their values may change without a bump. They are written to the generated theme stylesheet; a new colour or shadow shared between files is registered in `DERIVED_VARIABLES` (`src/packages/workbench-theme/lib/contract.ts`), not declared in a component stylesheet.',
    '',
    '| CSS variable | Meaning | Value |',
    '| --- | --- | --- |',
  );
  for (const variable of DERIVED_VARIABLES) {
    lines.push(`| \`${cssVarName(variable.name)}\` | ${variable.description} | \`${variable.value}\` |`);
  }
  lines.push(
    '',
    '## Adding a built-in theme',
    '',
    '1. Add a file under `src/packages/workbench-theme/lib/themes/`, starting from an existing theme. Give the theme an id (lowercase letters, digits, and hyphens; it is written to `data-workbench-theme`) and a name in Chinese and English.',
    '2. Fill the light table and the dark table: a value for every token above that does not follow another. A token marked "follows" may be left out, and then takes the value of the token it follows. Do not set the shared derived variables. Colours that text or marks are measured against must be hex or `rgb()`/`rgba()`.',
    '3. Add the theme to `BUILT_IN_THEMES` in `src/packages/workbench-theme/lib/themes.ts`. The first theme in the list is the one a device gets until it chooses; the theme picker lists the rest.',
    '4. Pass the theme check: `pnpm test src/packages/workbench-theme` runs `checkTheme` on every built-in theme, in light and in dark, and lists any token without a value, any entry the contract does not know, any colour it cannot read, and any text or mark below the contrast in the table above.',
    '5. Run `pnpm themes:generate` to write the theme stylesheet and this reference, then `pnpm check`. Its `pnpm lint:theme` step is the appearance guard: workbench styles and components read only the tokens and derived variables listed here.',
    '',
    '## The appearance guard',
    '',
    '`pnpm lint:theme` (part of `pnpm check`) reads every stylesheet and component under `src/web` and fails when one of them:',
    '',
    '- reads a CSS variable that is not a contract token, not a shared derived variable, and not declared in `src/web` (such as a retired pre-contract name; the message names the token to use instead);',
    '- writes a colour utility, `@theme` mapping, or shadow or radius utility under a name the contract does not define;',
    '- gives a contract token or a derived variable a value outside the generated theme stylesheet, or shares a colour computed from tokens between files without registering it;',
    '- paints a literal colour (hex, `rgb()`, `white`, a Tailwind palette colour such as `text-green-600`), except in files that paint the user\'s designed application, which are registered with the reason in `src/packages/workbench-theme/lib/guard.ts`;',
    '- uses `accent` or `muted` with their pre-contract meaning (brand colour, secondary text).',
    '',
  );
  return lines.join('\n');
}
