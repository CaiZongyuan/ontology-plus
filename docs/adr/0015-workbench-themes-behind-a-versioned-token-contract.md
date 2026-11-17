# Workbench Themes Behind a Versioned Token Contract

The audience of the workbench now includes business people (ADR 0014), and to them the warm-paper identity of ADR 0006 (serif titles, mono identifiers, paper grain) reads as an engineering tool. We decided that the look of the workbench is a `Workbench Theme` the user chooses, that components read only a versioned contract of semantic tokens, and that the default theme is a neutral one in the manner of Attio: sans type, hairline borders, restrained colour. Warm paper stays as the second built-in theme, 暖纸. This supersedes the palette and typeface choices of ADR 0006; its other usage rules stand.

A theme is a table of values for the contract, with one column for light and one for dark. It may set colours, three font families (title, interface, mono), corner radii, shadows, and a background texture. It may not change layout, spacing or density, the type-size scale, component structure, motion, or copy. Token names follow the shadcn convention (`background`, `foreground`, `primary`, `muted`, `border`, `ring`, and so on), extended with our own surface and status tokens. The chosen theme is stored on the device and is independent of the light / dark / system preference.

## Considered Options

- **Installable theme packages as in multica** (manifest, CSS, and assets; import, sanitiser, options, store). Rejected for now: that is the heaviest part of multica's appearance module and is still beta there. The value of the interface is the contract, and its shape leaves room to add packages later behind a version bump.
- **Colour-only themes.** Rejected: 暖纸 differs from the default in typeface and texture, and a contract exercised by one theme, or by two that differ only in hue, is unverified.
- **Keep the current token names** (`ground`, `ink`, and so on). Rejected: the redesign needs about ten primitives we do not have, taken from shadcn/ui in its Base UI flavour, which expect the shadcn names. They are also the names theme authors and agents already know.
- **Let themes restyle structure through stable anchors.** Rejected: the smaller the contract, the easier it is to guarantee a usable interface in every theme.

## Consequences

- Every built-in theme passes an automated check: each contract token has a light and a dark value, and text contrast meets the threshold. Adding a theme is filling in a table.
- Components and stylesheets are guarded by `pnpm lint:theme` (part of `pnpm check`) so they read only contract tokens and shared derived variables; transitional legacy token aliases were retired once all callers migrated, and `pnpm themes:generate` emits the theme CSS and `docs/workbench-theme-contract.md`.
- The `Default` theme uses the Attio-measured blue accent alongside self-hosted `Inter` and `JetBrains Mono` (paired with system sans for Chinese); shared typography uses a `14px` base (`>= 12px` minimum) across all themes.
- Tailwind preflight stays off (ADR 0006), so primitives copied from shadcn/ui need a scoped reset.
- Density and font size, if they become adjustable, are user preferences separate from the theme.
- Renaming or removing a contract token breaks themes and bumps the contract version.
