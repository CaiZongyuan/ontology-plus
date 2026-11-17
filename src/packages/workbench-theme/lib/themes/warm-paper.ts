import type { WorkbenchTheme } from '../types.js';

/**
 * 暖纸: the spatial-sync identity of ADR 0006. Warm paper with grain in light,
 * film grain ground in dark; serif titles, IBM Plex for the interface and for
 * identifiers.
 *
 * Four values differ from the original palette, each by the smallest step that
 * reaches 4.5:1 on the surfaces the text is used on: `faint-foreground` in both
 * modes, `warning` in light, and `destructive` in dark.
 */

const type = {
  'font-title': '"Noto Serif SC", "Source Han Serif SC", Georgia, serif',
  'font-sans': '"IBM Plex Sans", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
  'font-mono': '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};

const shape = {
  'radius-xs': '4px',
  'radius-sm': '6px',
  'radius-md': '8px',
  'radius-lg': '12px',
  'radius-card': '10px',
  'radius-window': '14px',
};

export const WARM_PAPER: WorkbenchTheme = {
  id: 'warm-paper',
  name: { zh: '暖纸', en: 'Warm Paper' },
  light: {
    ...type,
    ...shape,
    background: '#f3f2ee',
    canvas: '#eae8e2',
    foreground: '#1a1a18',
    'foreground-soft': '#2e2e2a',
    card: '#fdfdfb',
    muted: '#f6f5f1',
    'muted-foreground': '#5a5953',
    'faint-foreground': '#6a6862',
    accent: 'rgba(26, 26, 24, 0.045)',
    primary: '#4c50c4',
    'primary-foreground': '#ffffff',
    'primary-soft': 'rgba(76, 80, 196, 0.1)',
    border: '#d5d3cb',
    'border-subtle': '#e3e1da',
    'scrollbar-thumb': '#868379',
    overlay: '#0f0f0e',
    success: '#287452',
    'success-soft': 'rgba(40, 116, 82, 0.12)',
    warning: '#9b5c14',
    'warning-soft': 'rgba(168, 100, 22, 0.12)',
    destructive: '#b83a32',
    'destructive-soft': 'rgba(184, 58, 50, 0.12)',
    'shadow-xs': '0 1px 0 rgba(26, 26, 24, 0.04)',
    'shadow-sm': '0 1px 2px rgba(26, 26, 24, 0.06), 0 1px 1px rgba(26, 26, 24, 0.03)',
    'shadow-md': '0 4px 14px rgba(26, 26, 24, 0.08), 0 1px 3px rgba(26, 26, 24, 0.05)',
    'shadow-lg': '0 18px 48px rgba(26, 26, 24, 0.16), 0 4px 12px rgba(26, 26, 24, 0.08)',
    'backdrop-image':
      'url("/textures/paper/warm-grain.png"), url("/textures/paper/white-grain.png"), url("/textures/paper/cloud.png")',
    'backdrop-size': '260px 260px, 260px 260px, 900px 900px',
  },
  dark: {
    ...type,
    ...shape,
    background: '#121211',
    canvas: '#0d0d0c',
    foreground: '#eceae3',
    'foreground-soft': '#d2d0c8',
    card: '#1a1a18',
    muted: '#222220',
    'muted-foreground': '#98968e',
    'faint-foreground': '#8a8982',
    accent: 'rgba(236, 234, 227, 0.055)',
    primary: '#9ca4ff',
    'primary-foreground': '#0f1026',
    'primary-soft': 'rgba(156, 164, 255, 0.15)',
    border: '#33332e',
    'border-subtle': '#292925',
    'scrollbar-thumb': '#737169',
    overlay: '#0f0f0e',
    success: '#4ca97c',
    'success-soft': 'rgba(76, 169, 124, 0.16)',
    warning: '#df9a42',
    'warning-soft': 'rgba(223, 154, 66, 0.16)',
    destructive: '#e26e66',
    'destructive-soft': 'rgba(224, 97, 89, 0.16)',
    'shadow-xs': '0 1px 0 rgba(0, 0, 0, 0.3)',
    'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.4)',
    'shadow-md': '0 6px 18px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.35)',
    'shadow-lg': '0 24px 60px rgba(0, 0, 0, 0.6), 0 4px 12px rgba(0, 0, 0, 0.4)',
    'backdrop-image': 'none',
    'backdrop-size': '260px 260px, 260px 260px, 900px 900px',
  },
};
