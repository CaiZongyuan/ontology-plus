import { CONTRAST_PAIRS, THEME_CONTRACT_VERSION, THEME_TOKENS, THEME_TOKEN_GROUPS, cssVarName, type ThemeTokenGroup } from './contract.js';

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
  lines.push('');
  return lines.join('\n');
}
