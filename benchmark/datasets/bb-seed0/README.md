# bb-seed0

The three seed files of Business Bench `tasks/build/order-management` at commit
`b6e3b15c80b6f6cf11b7a35f10455e694145efe0`, kept byte for byte (BOM included).
They are deliberately dirty; the TeaCo reference app normalises them on import
(spec §4.2) and never edits these files. Checksums are pinned in
`benchmark/sources.lock.json`; `LICENSE.business-bench` is the upstream MIT licence.
The grader reference (`reference/counts.json`) is not vendored.
