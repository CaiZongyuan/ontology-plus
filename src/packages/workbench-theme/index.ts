export {
  THEME_CONTRACT_VERSION,
  THEME_TOKEN_GROUPS,
  THEME_TOKENS,
  CONTRAST_PAIRS,
  cssVarName,
  type ThemeTokenGroup,
  type ThemeTokenSpec,
  type ContrastPair,
} from './lib/contract.js';

export {
  THEME_ID_PATTERN,
  type ThemeMode,
  type ThemeTokenTable,
  type WorkbenchTheme,
} from './lib/types.js';

export { BUILT_IN_THEMES, DEFAULT_THEME_ID, findTheme, resolveThemeId } from './lib/themes.js';

export {
  resolveThemeTokens,
  compileThemeCss,
  compileBuiltInThemesCss,
  type CompileThemeOptions,
} from './lib/compile.js';

export { checkTheme, type ThemeProblem, type ThemeProblemKind } from './lib/check.js';

export { contrastRatio } from './lib/color.js';

export { renderContractDoc } from './lib/doc.js';
