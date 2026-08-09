# Session log — Rust port M0 (2026-08-09), preserved on archival

Kept per the owner's request when this branch was archived: the files and the run evidence stay,
because the `spec/` machinery next door is exactly the inventory of anonymous, cacheable responses
the Redis preloading work (built on `main` afterwards) warms from.

## What was run, and what it showed

- **Toolchain**: rustup 1.97.1 installed user-locally (no sudo); first `cargo build` of
  axum 0.8 + rusqlite 0.37 (bundled SQLite) finished in ~39 s on this box, zero warnings.
- **Goldens recorded** from the Django reference (`spec/conformance/record.mjs` against
  `127.0.0.1:8012`, worktree copy of the real seeded db): 6 cases — disciplines list ×3 `?lang=`
  variants, detail, detail-404, branches-with-topics-and-chapters.
- **Conformance** (`spec/conformance/run.mjs`):
  - Django reference: `6 passed, 0 failed` (sanity leg).
  - Rust port (`127.0.0.1:8090`, same db, read-only open): `6 passed, 0 failed` — first run.
- The port never gained write paths; the database was opened `SQLITE_OPEN_READ_ONLY` throughout.

## Why it was archived

The owner decided (same day) to stay with Django and spend the effort on the Redis
caching/delivery work instead — see `ENERGY-BRIEF.md` on the navbar branch for the analysis that
motivated that call, and CLAUDE.md on `main` for the feature that came of it. The spec + golden +
conformance mechanism remains valid if a port is ever picked back up; only this branch's Rust code
is frozen.
