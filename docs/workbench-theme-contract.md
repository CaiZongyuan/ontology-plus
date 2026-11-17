# Workbench Theme contract

<!-- Generated from src/packages/workbench-theme by `pnpm themes:generate`. Do not edit by hand. -->

Contract version: 1

A Workbench Theme is a table of values for the tokens below, one column for light and one for dark (ADR 0012). Components read only these tokens. A theme may not change layout, spacing or density, the type-size scale, component structure, motion, or copy.

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

## Status colours

| Token | CSS variable | Meaning | Follows |
| --- | --- | --- | --- |
| `success` | `--success` | Pass and success, as text or a mark. |  |
| `success-soft` | `--success-soft` | Tinted fill behind a success badge; may be translucent. |  |
| `warning` | `--warning` | Warning, as text or a mark. |  |
| `warning-soft` | `--warning-soft` | Tinted fill behind a warning badge; may be translucent. |  |
| `destructive` | `--destructive` | Errors and destructive actions, as text or a mark. |  |
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
| `ring` | `background` | 3:1 |
| `ring` | `card` | 3:1 |
| `scrollbar-thumb` | `background` | 3:1 |
| `scrollbar-thumb` | `card` | 3:1 |
