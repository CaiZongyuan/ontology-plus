# TeaCo supplier sources (extension fixtures)

Not part of Business Bench: small, hand-written supplier tables for the TeaCo-Extended knowledge
tasks (spec §14 T3-003/004, T5-008, T7-003/004/006).

- `leafline-quotes-2026-08.csv` — the supplier's August price sheet (UTF-8 BOM, CRLF, a quoted
  money value, and one malformed cell `"$2,40"` that must be reported, not converted).
- `leafline-quotes-2026-09.csv` — the September sheet of the same source: Silver Needle (1 lb) and
  Tie Guan Yin cost more, lead time for Silver Needle grows to 14 days.
- `leafline-email-2026-09.csv` — a separate email confirmation that disagrees on Silver Needle
  ($30.90 vs $32.90): both statements must stay visible as a dispute until someone decides.
