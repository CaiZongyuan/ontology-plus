import type { WorkbenchTheme } from '../types.js';

/**
 * 默认: the neutral default theme (ADR 0012), with values measured from Attio's
 * product interface on 2026-11-17 (issue #39). Sans titles and interface,
 * hairline borders, one blue for the primary action, flat ground.
 *
 * Sources, by precedence:
 * - app.attio.com/onboarding/welcome, the real product build: computed styles
 *   of its elements, and the light and dark theme tables its stylesheet
 *   defines (it follows `prefers-color-scheme`, so both modes are measured,
 *   not derived).
 * - The product-interface mock-ups on attio.com (real DOM, not images), light
 *   only.
 * Values marked "derived" in the #39 table have no direct Attio counterpart.
 *
 * Three values differ from the measurement, each by the smallest step that
 * passes `checkTheme`:
 * - `primary` light #266df0 -> #2466de: the measured blue is 4.07:1 on its own
 *   10% tint. The focus ring keeps #266df0.
 * - `faint-foreground` light rgba(0,0,0,0.502) -> rgba(0,0,0,0.55) (the value
 *   the attio.com mock-up uses for nav labels); dark rgba(255,255,255,0.451)
 *   -> rgba(255,255,255,0.46). Both measured values sit just under 4.5:1.
 * In dark, Attio keeps the #266df0 fill with white text; that blue is 4.07:1
 * on the dark ground, so dark `primary` uses Attio's dark link blue #4e8cfc
 * with dark text on it.
 *
 * Fonts: Inter (variable, with the optical-size axis, so titles get the
 * display cut by size) and JetBrains Mono, both OFL-1.1 and self-hosted under
 * /fonts (their @font-face rules are in src/web/tokens.css). Chinese is not
 * self-hosted: it uses Noto Sans SC when the device has it installed, then
 * the platform's own Chinese fonts.
 */

const CJK = '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei"';

const type = {
  'font-title': `"Inter", ${CJK}, system-ui, -apple-system, "Segoe UI", sans-serif`,
  'font-sans': `"Inter", ${CJK}, system-ui, -apple-system, "Segoe UI", sans-serif`,
  'font-mono': `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, ${CJK}, monospace`,
};

const shape = {
  'radius-xs': '4px',
  'radius-sm': '6px',
  'radius-md': '8px',
  'radius-lg': '12px',
  'radius-card': '12px',
  'radius-window': '16px',
};

/**
 * The knowledge graph's per-model colours: the 暖纸 hues, except M1, which takes this
 * theme's primary blue in place of indigo. One value in both modes; the model code on a
 * badge is white on each.
 */
const models = {
  'model-m1': '#2466de',
  'model-m2': '#287452',
  'model-m3': '#a86416',
  'model-me': '#8a3ab9',
  'model-m4': '#1d70b8',
  'model-m5': '#6e56cf',
  'model-m6': '#0f766e',
  'model-m7': '#b45309',
  'model-mu': '#be185d',
  'model-mm': '#4b5563',
  'model-mi': '#0369a1',
  'model-foreground': '#ffffff',
};

const flat = {
  'backdrop-image': 'none',
  'backdrop-size': 'auto',
};

export const DEFAULT_NEUTRAL: WorkbenchTheme = {
  id: 'default',
  name: { zh: '默认', en: 'Default' },
  light: {
    ...type,
    ...shape,
    ...flat,
    ...models,
    // Colours and surfaces
    background: '#ffffff',
    canvas: '#fbfbfb',
    foreground: '#101112',
    'foreground-soft': '#242629',
    card: '#ffffff',
    popover: '#ffffff',
    muted: '#f6f7f7',
    'muted-foreground': 'rgba(0, 0, 0, 0.631)',
    'faint-foreground': 'rgba(0, 0, 0, 0.55)',
    accent: 'rgba(0, 0, 0, 0.04)',
    primary: '#2466de',
    'primary-foreground': '#ffffff',
    'primary-soft': 'rgba(38, 109, 240, 0.1)',
    secondary: '#ffffff',
    border: '#e6e7ea',
    'border-subtle': '#eeeff1',
    ring: '#266df0',
    'scrollbar-thumb': '#898a8d',
    // Status colours
    success: '#007d53',
    'success-soft': '#e0fced',
    warning: '#874d00',
    'warning-soft': '#fff3cc',
    destructive: '#ba2525',
    'destructive-soft': '#ffebeb',
    // Shadows
    'shadow-xs': '0 0 2px rgba(28, 40, 64, 0.18), 0 1px 3px rgba(0, 0, 0, 0.04)',
    'shadow-sm': '0 1px 2px rgba(11, 13, 24, 0.04)',
    'shadow-md':
      '0 0 0 1px rgba(28, 40, 64, 0.04), 0 4px 8px -4px rgba(28, 40, 64, 0.12), 0 4px 12px -2px rgba(24, 41, 75, 0.16)',
    'shadow-lg':
      '0 8px 28px -6px rgba(28, 40, 64, 0.12), 0 18px 88px -4px rgba(28, 40, 64, 0.16), 0 0 1px rgba(28, 40, 64, 0.16)',
    'shadow-color': '#1c2840',
  },
  dark: {
    ...type,
    ...shape,
    ...flat,
    ...models,
    // Colours and surfaces
    background: '#101112',
    canvas: '#0b0c0d',
    foreground: '#f1f2f3',
    'foreground-soft': '#e6e7ea',
    card: '#101112',
    popover: '#17181a',
    muted: '#1b1c1f',
    'muted-foreground': 'rgba(255, 255, 255, 0.6)',
    'faint-foreground': 'rgba(255, 255, 255, 0.46)',
    accent: 'rgba(255, 255, 255, 0.05)',
    primary: '#4e8cfc',
    'primary-foreground': '#101112',
    'primary-soft': 'rgba(38, 109, 240, 0.1)',
    secondary: '#1b1c1f',
    border: '#212224',
    'border-subtle': '#1b1c1f',
    ring: '#266df0',
    'scrollbar-thumb': '#77797c',
    // Status colours
    success: '#4ad99a',
    'success-soft': '#1d4034',
    warning: '#f5a300',
    'warning-soft': '#3a2d12',
    destructive: '#ff8180',
    'destructive-soft': '#4e1b28',
    // Shadows
    'shadow-xs': '0 0 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.12)',
    'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.24)',
    'shadow-md':
      '0 0 0 1px rgba(0, 0, 0, 0.16), 0 4px 8px -4px rgba(0, 0, 0, 0.24), 0 4px 12px -2px rgba(0, 0, 0, 0.32)',
    'shadow-lg': '0 8px 28px -6px rgba(0, 0, 0, 0.48), 0 18px 88px -4px rgba(0, 0, 0, 0.64)',
    'shadow-color': '#000000',
  },
};
