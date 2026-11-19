import { describe, expect, it } from 'vitest';
import {
  CURATED_INSPO_CATALOG,
  approvedBriefStyleValues,
  deriveStyleTileFromReferences,
  styleTileTokensToValues,
  type DesignBrief,
} from '../index.js';

describe('approvedBriefStyleValues (P4: pre-#91 approved DesignBrief lock derivation)', () => {
  const primary = CURATED_INSPO_CATALOG[0]!;
  const donor = CURATED_INSPO_CATALOG.find((item) => item.slug !== primary.slug)!;

  it('derives the exact Style Tile values from references when an approved brief predates styleValues', () => {
    const legacyApprovedBrief: DesignBrief = {
      items: [{ id: '1', category: 'tone', statement: '清爽工作台' }],
      primaryReferenceId: primary.slug,
      borrowedReferences: [{ aspect: 'accentColor', referenceId: donor.slug }],
      motionSchematicIds: ['MODULAR_CARDS'],
      userFeelNote: '深色模式，留白宽松一点',
      approvedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const expected = styleTileTokensToValues(
      deriveStyleTileFromReferences({
        primary,
        borrowed: [{ aspect: 'accentColor', item: donor }],
        informationDensity: 'MODULAR_CARDS',
        userFeelNote: '深色模式，留白宽松一点',
      }),
    );

    const res = approvedBriefStyleValues(legacyApprovedBrief);
    expect(res).toEqual({ values: expected, derived: true });
  });

  it('falls back to deriving from references if stored styleValues is empty, and reports underivable when references are gone', () => {
    const corruptStoredBrief: DesignBrief = {
      items: [],
      primaryReferenceId: primary.slug,
      styleValues: {} as NonNullable<DesignBrief['styleValues']>,
      approvedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const fallback = approvedBriefStyleValues(corruptStoredBrief);
    expect(fallback.values).not.toBeNull();
    expect('derived' in fallback && fallback.derived).toBe(true);

    const missingRefBrief: DesignBrief = {
      items: [],
      primaryReferenceId: 'deleted-inspo-slug-not-in-catalog',
      approvedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    expect(approvedBriefStyleValues(missingRefBrief)).toEqual({ values: null, underivable: true });

    const unapprovedBrief: DesignBrief = {
      items: [],
      primaryReferenceId: 'deleted-inspo-slug-not-in-catalog',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    expect(approvedBriefStyleValues(unapprovedBrief)).toEqual({ values: null, underivable: false });
  });
});
