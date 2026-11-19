# Workbench Theme contract

<!-- Generated from src/packages/workbench-theme by `pnpm themes:generate`. Do not edit by hand. -->

Contract version: 1

A Workbench Theme is a table of values for the tokens below, one column for light and one for dark (ADR 0015). Components read only these tokens. A theme may not change layout, spacing or density, the type-size scale, component structure, motion, or copy.

A token marked "follows" takes the value of another token when a theme leaves it unset. Renaming or removing a token breaks themes and bumps the contract version.

## Colours and surfaces

| Token | CSS variable | Meaning | Follows |
| --- | --- | --- | --- |
| `background` | `--background` | The page ground everything sits on. |  |
| `canvas` | `--canvas` | A deeper ground: the navigation rail, wells, and the area behind panels. |  |
| `foreground` | `--foreground` | Body text and primary headings. |  |
| `foreground-soft` | `--foreground-soft` | Text one step quieter than body text, such as secondary headings. |  |
| `card` | `--card` | Bounded surfaces: cards and panels. |  |
| `card-foreground` | `--card-foreground` | Text on a card. | `foreground` |
| `popover` | `--popover` | Raised surfaces: menus, popovers, and dialogs. | `card` |
| `popover-foreground` | `--popover-foreground` | Text on a raised surface. | `foreground` |
| `muted` | `--muted` | Quiet fill for insets, fields, and table headers. |  |
| `muted-foreground` | `--muted-foreground` | Secondary text. |  |
| `faint-foreground` | `--faint-foreground` | Tertiary text: captions, meta, and placeholders. |  |
| `accent` | `--accent` | Hover and pressed fill on rows and quiet controls; may be translucent. |  |
| `accent-foreground` | `--accent-foreground` | Text on the hover fill. | `foreground` |
| `primary` | `--primary` | The single primary action of a region, selection, and links. |  |
| `primary-foreground` | `--primary-foreground` | Text on primary. |  |
| `primary-soft` | `--primary-soft` | Tinted fill behind selected or highlighted items; may be translucent. |  |
| `secondary` | `--secondary` | Fill of secondary buttons. | `muted` |
| `secondary-foreground` | `--secondary-foreground` | Text on a secondary button. | `foreground` |
| `border` | `--border` | Dividers and the outline of surfaces. |  |
| `border-subtle` | `--border-subtle` | Quieter dividers inside a surface. |  |
| `input` | `--input` | The outline of inputs. | `border` |
| `ring` | `--ring` | Focus ring colour. | `primary` |
| `scrollbar-thumb` | `--scrollbar-thumb` | The scrollbar thumb; a mark, not text. |  |
| `overlay` | `--overlay` | The scrim behind modal dialogs and lightboxes, as an opaque colour; each caller sets its opacity. |  |

## Status colours

| Token | CSS variable | Meaning | Follows |
| --- | --- | --- | --- |
| `success` | `--success` | Pass and success, as text or a mark. |  |
| `success-soft` | `--success-soft` | Tinted fill behind a success badge; may be translucent. |  |
| `warning` | `--warning` | Warning, as text or a mark. |  |
| `warning-soft` | `--warning-soft` | Tinted fill behind a warning badge; may be translucent. |  |
| `destructive` | `--destructive` | Errors and destructive actions, as text or a mark. |  |
| `destructive-foreground` | `--destructive-foreground` | Text on a destructive fill, such as a confirm-delete button. | `primary-foreground` |
| `destructive-soft` | `--destructive-soft` | Tinted fill behind an error badge; may be translucent. |  |

## Ontology model colours

| Token | CSS variable | Meaning | Follows |
| --- | --- | --- | --- |
| `model-m1` | `--model-m1` | Marks model M1 in the knowledge graph: lanes, nodes, chips, and the minimap. |  |
| `model-m2` | `--model-m2` | Marks model M2 in the knowledge graph. |  |
| `model-m3` | `--model-m3` | Marks model M3 in the knowledge graph. |  |
| `model-me` | `--model-me` | Marks model ME in the knowledge graph. |  |
| `model-m4` | `--model-m4` | Marks model M4 in the knowledge graph. |  |
| `model-m5` | `--model-m5` | Marks model M5 in the knowledge graph. |  |
| `model-m6` | `--model-m6` | Marks model M6 in the knowledge graph. |  |
| `model-m7` | `--model-m7` | Marks model M7 in the knowledge graph. |  |
| `model-mu` | `--model-mu` | Marks model MU in the knowledge graph. |  |
| `model-mm` | `--model-mm` | Marks model MM in the knowledge graph. |  |
| `model-mi` | `--model-mi` | Marks model MI in the knowledge graph. |  |
| `model-foreground` | `--model-foreground` | Text on a model colour, such as the model code on a badge. |  |

## Fonts

| Token | CSS variable | Meaning | Follows |
| --- | --- | --- | --- |
| `font-title` | `--font-title` | Page titles, card titles, and large metrics. |  |
| `font-sans` | `--font-sans` | Everything in the interface that is not a title or an identifier. |  |
| `font-mono` | `--font-mono` | Ontology identifiers, code, and paths. |  |
| `font-annotation` | `--font-annotation` | Handwritten callouts on prototype screens (Design Notes). |  |

## Corner radii

| Token | CSS variable | Meaning | Follows |
| --- | --- | --- | --- |
| `radius-xs` | `--radius-xs` | The smallest corner: checkboxes and inline marks. |  |
| `radius-sm` | `--radius-sm` | Chips, badges, and compact controls. |  |
| `radius-md` | `--radius-md` | Buttons, inputs, and menus items. |  |
| `radius-lg` | `--radius-lg` | Large insets and media. |  |
| `radius-card` | `--radius-card` | Cards and panels. |  |
| `radius-window` | `--radius-window` | Dialogs and the outermost frames. |  |

## Shadows

| Token | CSS variable | Meaning | Follows |
| --- | --- | --- | --- |
| `shadow-xs` | `--shadow-xs` | A hairline lift under controls. |  |
| `shadow-sm` | `--shadow-sm` | Cards at rest. |  |
| `shadow-md` | `--shadow-md` | Raised surfaces: menus and popovers. |  |
| `shadow-lg` | `--shadow-lg` | Overlays: dialogs and drawers. |  |
| `shadow-color` | `--shadow-color` | The colour of a one-off shadow that is none of the four elevations; mixed with transparent where it is used. |  |

## Background texture

| Token | CSS variable | Meaning | Follows |
| --- | --- | --- | --- |
| `backdrop-image` | `--backdrop-image` | Texture laid over the page ground, as a CSS background-image; `none` for a flat ground. |  |
| `backdrop-size` | `--backdrop-size` | The background-size of the texture. |  |

## Contrast

Every built-in theme is checked in both modes. Text must reach 4.5:1 and marks 3:1 on the surfaces they are used on. A translucent surface is measured painted over the surface named after "over".

| Token | On | Minimum |
| --- | --- | --- |
| `foreground` | `background` | 4.5:1 |
| `foreground` | `canvas` | 4.5:1 |
| `foreground` | `card` | 4.5:1 |
| `foreground` | `muted` | 4.5:1 |
| `foreground-soft` | `background` | 4.5:1 |
| `foreground-soft` | `canvas` | 4.5:1 |
| `foreground-soft` | `card` | 4.5:1 |
| `foreground-soft` | `muted` | 4.5:1 |
| `muted-foreground` | `background` | 4.5:1 |
| `muted-foreground` | `canvas` | 4.5:1 |
| `muted-foreground` | `card` | 4.5:1 |
| `muted-foreground` | `muted` | 4.5:1 |
| `faint-foreground` | `background` | 4.5:1 |
| `faint-foreground` | `canvas` | 4.5:1 |
| `faint-foreground` | `card` | 4.5:1 |
| `faint-foreground` | `muted` | 4.5:1 |
| `card-foreground` | `card` | 4.5:1 |
| `popover-foreground` | `popover` | 4.5:1 |
| `secondary-foreground` | `secondary` | 4.5:1 |
| `accent-foreground` | `accent` over `card` | 4.5:1 |
| `accent-foreground` | `accent` over `background` | 4.5:1 |
| `accent-foreground` | `accent` over `canvas` | 4.5:1 |
| `primary-foreground` | `primary` | 4.5:1 |
| `primary` | `background` | 4.5:1 |
| `primary` | `card` | 4.5:1 |
| `primary` | `primary-soft` over `card` | 4.5:1 |
| `success` | `card` | 4.5:1 |
| `success` | `success-soft` over `card` | 4.5:1 |
| `warning` | `card` | 4.5:1 |
| `warning` | `warning-soft` over `card` | 4.5:1 |
| `destructive` | `card` | 4.5:1 |
| `destructive` | `destructive-soft` over `card` | 4.5:1 |
| `destructive-foreground` | `destructive` | 4.5:1 |
| `model-foreground` | `model-m1` | 4.5:1 |
| `model-foreground` | `model-m2` | 4.5:1 |
| `model-foreground` | `model-m3` | 4.5:1 |
| `model-foreground` | `model-me` | 4.5:1 |
| `model-foreground` | `model-m4` | 4.5:1 |
| `model-foreground` | `model-m5` | 4.5:1 |
| `model-foreground` | `model-m6` | 4.5:1 |
| `model-foreground` | `model-m7` | 4.5:1 |
| `model-foreground` | `model-mu` | 4.5:1 |
| `model-foreground` | `model-mm` | 4.5:1 |
| `model-foreground` | `model-mi` | 4.5:1 |
| `model-m1` | `card` | 3:1 |
| `model-m1` | `background` | 3:1 |
| `model-m2` | `card` | 3:1 |
| `model-m2` | `background` | 3:1 |
| `model-m3` | `card` | 3:1 |
| `model-m3` | `background` | 3:1 |
| `model-me` | `card` | 3:1 |
| `model-me` | `background` | 3:1 |
| `model-m4` | `card` | 3:1 |
| `model-m4` | `background` | 3:1 |
| `model-m5` | `card` | 3:1 |
| `model-m5` | `background` | 3:1 |
| `model-m6` | `card` | 3:1 |
| `model-m6` | `background` | 3:1 |
| `model-m7` | `card` | 3:1 |
| `model-m7` | `background` | 3:1 |
| `model-mu` | `card` | 3:1 |
| `model-mu` | `background` | 3:1 |
| `model-mm` | `card` | 3:1 |
| `model-mm` | `background` | 3:1 |
| `model-mi` | `card` | 3:1 |
| `model-mi` | `background` | 3:1 |
| `ring` | `background` | 3:1 |
| `ring` | `card` | 3:1 |
| `scrollbar-thumb` | `background` | 3:1 |
| `scrollbar-thumb` | `card` | 3:1 |

## Shared derived variables

These are computed from contract tokens and are the same for every theme, so a theme author does not fill them: they follow the tokens they are made of. Components may read them as they read contract tokens, so their names are part of the contract: renaming or removing one breaks components and bumps the contract version, as it does for a token. Their values may change without a bump. They are written to the generated theme stylesheet; a new colour or shadow shared between files is registered in `DERIVED_VARIABLES` (`src/packages/workbench-theme/lib/contract.ts`), not declared in a component stylesheet.

| CSS variable | Meaning | Value |
| --- | --- | --- |
| `--accent-strong` | A stronger hover fill, for controls that already sit on the quiet fill. | `color-mix(in srgb, var(--foreground) 8%, transparent)` |
| `--border-strong` | A stronger outline: control outlines and hovered borders. | `color-mix(in srgb, var(--muted-foreground) 42%, var(--border))` |
| `--focus-ring` | A soft focus halo, as a box-shadow, for fields that show focus without an outline. | `0 0 0 3px color-mix(in srgb, var(--ring) 28%, transparent)` |
| `--shadow-hairline` | A hairline outline, as a box-shadow. | `0 0 0 1px var(--border)` |
| `--shadow-btn` | `shadow-xs` with a control outline: buttons and segmented controls. | `0 0 0 1px var(--border-strong), var(--shadow-xs)` |
| `--shadow-card` | `shadow-sm` with a hairline outline, so cards read on any ground. | `0 0 0 1px var(--border), var(--shadow-sm)` |
| `--shadow-raised` | `shadow-md` with a hairline outline: menus and popovers. | `0 0 0 1px var(--border), var(--shadow-md)` |
| `--shadow-overlay` | `shadow-lg` with a hairline outline: dialogs and drawers. | `0 0 0 1px var(--border), var(--shadow-lg)` |

## Adding a built-in theme

1. Add a file under `src/packages/workbench-theme/lib/themes/`, starting from an existing theme. Give the theme an id (lowercase letters, digits, and hyphens; it is written to `data-workbench-theme`) and a name in Chinese and English.
2. Fill the light table and the dark table: a value for every token above that does not follow another. A token marked "follows" may be left out, and then takes the value of the token it follows. Do not set the shared derived variables. Colours that text or marks are measured against must be hex or `rgb()`/`rgba()`.
3. Add the theme to `BUILT_IN_THEMES` in `src/packages/workbench-theme/lib/themes.ts`. The first theme in the list is the one a device gets until it chooses; the theme picker lists the rest.
4. Pass the theme check: `pnpm test src/packages/workbench-theme` runs `checkTheme` on every built-in theme, in light and in dark, and lists any token without a value, any entry the contract does not know, any colour it cannot read, and any text or mark below the contrast in the table above.
5. Run `pnpm themes:generate` to write the theme stylesheet and this reference, then `pnpm check`. Its `pnpm lint:theme` step is the appearance guard: workbench styles and components read only the tokens and derived variables listed here.

## The appearance guard

`pnpm lint:theme` (part of `pnpm check`) reads every stylesheet and component under `src/web` and fails when one of them:

- reads a CSS variable that is not a contract token, not a shared derived variable, and not declared in `src/web` (such as a retired pre-contract name; the message names the token to use instead);
- writes a colour utility, `@theme` mapping, or shadow or radius utility under a name the contract does not define;
- gives a contract token or a derived variable a value outside the generated theme stylesheet, or shares a colour computed from tokens between files without registering it;
- paints a literal colour (hex, `rgb()`, `white`, a Tailwind palette colour such as `text-green-600`), except in files that paint the user's designed application, which are registered with the reason in `src/packages/workbench-theme/lib/guard.ts`;
- writes a literal corner radius (`border-radius: 6px`, `rounded-[6px]`, `borderRadius: 6`) instead of a radius token, except a pill (`999px`), a circle (`50%`), and shapes registered with the reason in `RADIUS_EXCEPTIONS` in `src/packages/workbench-theme/lib/guard.ts`;
- uses `accent` or `muted` with their pre-contract meaning (brand colour, secondary text).
