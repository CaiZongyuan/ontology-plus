/**
 * The Style Tile derivation (#91): from the chosen Visual References and the user's own words to
 * the design values a prototype build is locked to. The wizard shows these tokens; the engine
 * derives the same values for briefs approved before the values were stored on the brief.
 */

import { readPrototypeStyleValues, type PrototypeStyleValues } from '../../ontology-core/index.js';
import { CURATED_INSPO_CATALOG, type VisualReferenceItem } from './inspo-cache.js';
import type { DesignBrief } from './types.js';

export interface StyleTileTokens {
  mode: 'light' | 'dark';
  surfaceHex: string;
  cardHex: string;
  insetHex: string;
  accentHex: string;
  accentInkHex: string;
  secondaryAccentHex: string;
  borderHex: string;
  inkHex: string;
  mutedInkHex: string;
  semanticOkHex: string;
  semanticWarnHex: string;
  semanticDangerHex: string;
  fontFamily: string;
  fontDisplayLabel: string;
  radiusPx: number;
  isCompact: boolean;
}

function isLightHexColor(hex: string): boolean {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140;
}

// The style tile previews the app being designed: its surfaces, ink, accent, and status
// colours are the prototype's, not workbench appearance, and stay literal whatever
// Workbench Theme is active.
function pickReadableInkForAccent(hex: string): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 165 ? '#111827' : '#ffffff';
}

export interface StyleTileReferences {
  primary: VisualReferenceItem;
  borrowed: readonly { aspect: string; item: VisualReferenceItem }[];
  /** The chosen information-density schematic (COMPACT_LEDGER by default). */
  informationDensity?: string;
  userFeelNote?: string;
}

/** The Style Tile tokens of a set of Visual References and the user's own words. */
export function deriveStyleTileFromReferences(input: StyleTileReferences): StyleTileTokens {
  const selection = input;
  const userFeelNote = input.userFeelNote ?? '';
  const bgDonor =
    selection.borrowed.find((b) => b.aspect === 'bgColor')?.item ?? selection.primary;
  const accentDonor =
    selection.borrowed.find((b) => b.aspect === 'accentColor')?.item ?? selection.primary;
  const borderDonor =
    selection.borrowed.find((b) => b.aspect === 'cardBorder')?.item ?? selection.primary;
  const typoDonor =
    selection.borrowed.find((b) => b.aspect === 'typography')?.item ?? selection.primary;
  const spacingBorrowed = selection.borrowed.some((b) => b.aspect === 'spacing');
  const clarityBorrowed = selection.borrowed.some((b) => b.aspect === 'dataClarity');

  const feelLower = userFeelNote.toLowerCase();
  const explicitDarkCue =
    /深色|暗黑|暗色|黑底|夜间|dark\s*mode|dark\s*theme|dark\s*cockpit/.test(feelLower) &&
    !/浅色|白底|纸感|light\s*mode/.test(feelLower);
  const explicitLightCue =
    /浅色|白底|暖白|纸感|light\s*mode|warm\s*paper/.test(feelLower) && !explicitDarkCue;

  let surfaceHex = bgDonor.surfaceHex || '#f8fafc';
  if (explicitDarkCue && isLightHexColor(surfaceHex)) {
    surfaceHex = '#0f172a';
  } else if (explicitLightCue && !isLightHexColor(surfaceHex)) {
    surfaceHex = '#f8f5ef';
  }

  const isDark =
    explicitDarkCue || (!explicitLightCue && (!isLightHexColor(surfaceHex) || bgDonor.mode === 'dark'));
  const isWarmPaper = !isDark && bgDonor.vibeGroup === 'warm-paper';

  const cardHex = isDark ? '#162033' : isWarmPaper ? '#fffdf9' : '#ffffff';
  const insetHex = isDark ? '#1e293b' : isWarmPaper ? '#f2ece1' : '#f1f5f9';
  const borderHex = isDark ? '#334155' : isWarmPaper ? '#dfd6c7' : '#e2e8f0';
  const inkHex = isDark ? '#f1f5f9' : isWarmPaper ? '#1f1d1a' : '#0f172a';
  const mutedInkHex = isDark ? '#94a3b8' : isWarmPaper ? '#6b6459' : '#64748b';

  const accentHex = accentDonor.palette[0] || '#2563eb';
  const secondaryAccentHex =
    accentDonor.palette[1] || selection.primary.palette[1] || accentHex;
  const accentInkHex = pickReadableInkForAccent(accentHex);

  const semanticOkHex = isDark ? '#34d399' : '#15803d';
  const semanticWarnHex = isDark ? '#fbbf24' : '#b45309';
  const semanticDangerHex = isDark ? '#f87171' : '#dc2626';

  const fontDisplayLabel = typoDonor.fonts[0] || 'Inter';
  const fontFamily =
    typoDonor.vibeGroup === 'warm-paper'
      ? `'Georgia', 'Noto Serif SC', -apple-system, sans-serif`
      : `'${fontDisplayLabel}', -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif`;

  const informationDensity = input.informationDensity ?? 'COMPACT_LEDGER';
  const compactCue =
    /紧凑|高密度|台账|交易|compact|dense|ledger|trading/.test(feelLower) &&
    !/宽松|呼吸|大留白|airy|spacious/.test(feelLower);
  const airyCue = /宽松|呼吸|大留白|airy|spacious/.test(feelLower);

  const isCompact = airyCue
    ? false
    : compactCue ||
      clarityBorrowed ||
      (!spacingBorrowed && informationDensity === 'COMPACT_LEDGER');

  return {
    mode: isDark ? 'dark' : 'light',
    surfaceHex,
    cardHex,
    insetHex,
    accentHex,
    accentInkHex,
    secondaryAccentHex,
    borderHex,
    inkHex,
    mutedInkHex,
    semanticOkHex,
    semanticWarnHex,
    semanticDangerHex,
    fontFamily,
    fontDisplayLabel,
    radiusPx: borderDonor.radiusPx,
    isCompact,
  };
}

/**
 * The Style Tile as design values for the prototype build (#91). Stored on the brief when the
 * user approves it, these values are locked: the lead assistant draws the 风格样张 with them.
 */
export function styleTileTokensToValues(tokens: StyleTileTokens): PrototypeStyleValues {
  return {
    mode: tokens.mode,
    background: tokens.surfaceHex,
    surface: tokens.cardHex,
    inset: tokens.insetHex,
    accent: tokens.accentHex,
    accentInk: tokens.accentInkHex,
    border: tokens.borderHex,
    ink: tokens.inkHex,
    mutedInk: tokens.mutedInkHex,
    ok: tokens.semanticOkHex,
    warn: tokens.semanticWarnHex,
    danger: tokens.semanticDangerHex,
    fontFamily: tokens.fontFamily,
    radiusPx: tokens.radiusPx,
    density: tokens.isCompact ? 'compact' : 'comfortable',
  };
}


const DENSITY_SCHEMATICS = new Set(['COMPACT_LEDGER', 'MODULAR_CARDS']);

/**
 * The approved values of a Design Brief: the stored ones, or — for a brief approved before they
 * were stored — the same derivation from the brief's references. Null when the brief is not
 * approved, or when its references can no longer be found (then nothing is locked).
 */
export function approvedBriefStyleValues(
  brief: DesignBrief | null | undefined,
  catalog: readonly VisualReferenceItem[] = CURATED_INSPO_CATALOG,
): { values: PrototypeStyleValues; derived: boolean } | { values: null; underivable: boolean } {
  if (!brief?.approvedAt) return { values: null, underivable: false };
  if (brief.styleValues && Object.keys(readPrototypeStyleValues(brief.styleValues)).length > 0) {
    return { values: brief.styleValues, derived: false };
  }
  const primary = brief.primaryReferenceId ? catalog.find((c) => c.slug === brief.primaryReferenceId) : undefined;
  if (!primary) return { values: null, underivable: true };
  const borrowed: { aspect: string; item: VisualReferenceItem }[] = [];
  for (const b of brief.borrowedReferences ?? []) {
    const item = catalog.find((c) => c.slug === b.referenceId);
    if (item && item.slug !== primary.slug && !borrowed.some((x) => x.item.slug === item.slug)) {
      borrowed.push({ aspect: b.aspect, item });
    }
  }
  const density = (brief.motionSchematicIds ?? []).find((id) => DENSITY_SCHEMATICS.has(id));
  const tokens = deriveStyleTileFromReferences({
    primary,
    borrowed,
    ...(density ? { informationDensity: density } : {}),
    userFeelNote: brief.userFeelNote ?? '',
  });
  return { values: styleTileTokensToValues(tokens), derived: true };
}
