# Warm-Paper & Film-Grain Design System with Bilingual i18n

We adopt the restrained editorial workbench aesthetic from `spatial-sync` (`tokens.css` & `shell.css`): CSS custom properties driving both a dark mode (`#121211` ground, `#9ca4ff` indigo accent, subtle fractal film grain) and a warm-paper light mode (`#f3f2ee` ground, `#4c50c4` indigo accent, pre-rendered paper grain textures), paired with `Noto Serif SC` for headings/metrics and locally bundled `IBM Plex Sans` / `IBM Plex Mono` for UI controls and ontology identifiers. The shell provides persistent light/dark/system theme switching and zero-latency Chinese/English (`zh-CN` / `en-US`) language switching stored in `localStorage`.


## Usage rules (added 2026-11-11)

A Hex-style replacement shell was prototyped (branch `prototype/hex-shell-variants`) and rejected: the warm-paper identity stays. What was wrong was inconsistent application, so the system gains rules rather than new colours.

- **Type roles.** `Noto Serif SC` is for page titles, card titles and large metrics only. `IBM Plex Mono` is for ontology identifiers (`AGG-01`, `RULE-02`), code and paths only. Everything else, including placeholders, badges and buttons, is `IBM Plex Sans`. Sizes come from the `--text-*` scale in `tokens.css`.
- **One button.** `components/beautifui/Button` is the only button: 6px corners, three heights (`xs`/`sm`/`md`). `accent` marks the single primary action of a region, `secondary` (outline) is the default, `toggle` with `aria-pressed`/`aria-selected` is the only segmented or filter control. Global `.btn*` classes are gone. Pill shapes are reserved for status badges.
- **Colour carries meaning.** Badges are neutral by default; green, amber and red mean pass, warning and error; indigo means interactive or selected.
- **Depth by tone.** Layers are separated by `--ground` → `--surface` → `--surface-2`, not by stacking borders and shadows. Cards nest at most two levels and the inner level has no shadow.
- **No preflight.** Tailwind preflight stays off because it flattens rendered markdown; `tokens.css` carries a control-only reset in the lowest cascade layer.
- **Copy.** Titles are short and in the active locale only; English glosses belong in the `en-US` strings, not in parentheses after the Chinese.
- **Motion.** Motion is quiet and editorial: sections settle in reading order, the nav marker draws in, dialogs rise, chat turns fade up. Only `opacity` and `transform` are animated, nothing runs longer than 320ms, and `prefers-reduced-motion` turns all of it off.
- **Spacing.** Tailwind's spacing step is pinned to 4px (`--spacing` in `tokens.css`) because the root font size is 13px; layout uses utilities on that step, and `style={{…}}` is reserved for values computed at runtime or deliberate overrides of a shell class.
