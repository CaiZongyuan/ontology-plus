/** Colour arithmetic for the theme check: parsing, compositing, and WCAG contrast. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*([^)]+)\)$/i;

function channel(part: string): number | null {
  const value = part.endsWith('%') ? (Number(part.slice(0, -1)) / 100) * 255 : Number(part);
  return Number.isFinite(value) ? Math.min(255, Math.max(0, value)) : null;
}

function alpha(part: string | undefined): number | null {
  if (part === undefined) return 1;
  const value = part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

/** Reads `#rgb`, `#rrggbb` (with optional alpha) and `rgb()` / `rgba()`; anything else is `null`. */
export function parseColor(input: string): Rgba | null {
  const value = input.trim();
  const hex = HEX.exec(value);
  if (hex) {
    const digits = hex[1]!;
    const full = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = RGB.exec(value);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) return null;
    const [r, g, b] = parts.slice(0, 3).map(channel);
    const a = alpha(parts[3]);
    if (r == null || g == null || b == null || a == null) return null;
    return { r, g, b, a };
  }
  return null;
}

/** `top` painted over an opaque `bottom`. */
export function compositeOver(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function linear(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Rgba): number {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/**
 * WCAG contrast of `text` on `surface`. A translucent surface is first painted
 * over `under`, and translucent text over the resulting surface. Returns
 * `null` when a colour cannot be read or a translucent surface has nothing
 * opaque under it.
 */
export function contrastRatio(text: string, surface: string, under?: string): number | null {
  const textColor = parseColor(text);
  let surfaceColor = parseColor(surface);
  if (!textColor || !surfaceColor) return null;
  if (surfaceColor.a < 1) {
    const underColor = under ? parseColor(under) : null;
    if (!underColor || underColor.a < 1) return null;
    surfaceColor = compositeOver(surfaceColor, underColor);
  }
  const painted = textColor.a < 1 ? compositeOver(textColor, surfaceColor) : textColor;
  const a = relativeLuminance(painted);
  const b = relativeLuminance(surfaceColor);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
