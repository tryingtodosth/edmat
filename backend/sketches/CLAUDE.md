# sketches/ — freehand whiteboard drawings embedded in content

One model, one viewset, ~200 lines. It exists because Piotr asked for "dodawanie obrazków myszką —
pisanie jak na Zoom … jako opcja dodawania treści/komentarzy": a button that opens a fullscreen XY
canvas you draw on with the mouse, pan and zoom around, and whose result lands in the sentence you
are writing.

## Read `chem/` first — this is that app again

`sketches/` is a deliberate near-copy of `chem/`, with a different editor behind it. Same shape,
same reasons, and the differences are the only interesting part:

| | `chem/` | `sketches/` |
|---|---|---|
| Editor | Ketcher (Apache 2.0) | Excalidraw (MIT) — checked on npm at install time, not remembered |
| Source | KET JSON or an MDL Molfile | the Excalidraw scene JSON |
| Picture | sanitized SVG (vector), or a re-encoded raster | **always** a re-encoded WebP |
| Embed | `<img data-chem=… class="chem-drawing">` | `<img data-sketch=… class="sketch-drawing" width height loading="lazy">` |
| Flag / throttle | `chemistry` / `chem_drawing` 60/hour | `sketches` / `sketch` 60/hour |

**Why no vector here.** A chem structure is a dozen straight bonds and a few letters, so
`chem/svg.py` can rebuild it from an allowlist and the result stays small and sharp. A freehand
stroke is a `<path>` with hundreds of points; a board of them is a large SVG whose every byte would
have to be re-derived through a sanitizer written for geometry diagrams. The thing being drawn is
line art that a 1600px WebP renders perfectly, so the editor exports PNG and `imaging.py` does what
it does for every other picture here. If a future feature genuinely needs the vector, move
`chem/svg.py` to a shared top-level module first rather than importing it across an app boundary —
the same argument that pulled `imaging.py` out of `accounts/avatar.py` (two copies of a security
bound is how one gets fixed after an incident and the other does not).

## The rules this app holds

- **Never the bytes that arrived** (house rule 7). `SketchWriteSerializer._prepare_picture` is byte
  cap → sniff → declared-dimension budget → decode → re-encode WebP, every layer from `imaging.py`.
  A PE named `.png` with a `data:image/png` label is refused by the sniff, and a polyglot does not
  survive the re-encode, which keeps only pixels. There is a test for each.
- **Bounded source.** `MAX_SOURCE_BYTES` is 512 KB and the scene must parse as a JSON object with
  an `elements` array. That is the whole validation — there is no drawing engine on the server and
  it does not pretend to have one.
- **Authority is asked explicitly** (house rule 4). `get_queryset` scopes only `list`; `update`
  is addressed by pk, so it compares `author_id` itself before anything is written. A stranger gets
  **403**, not 404 — the sketch is public by GET, so pretending it is missing would be a lie the
  caller can disprove in one request.
- **No DELETE.** A sketch a published comment embeds must keep resolving. An author who wants it
  gone edits the text that shows it. (Left open: no "my sketches" page either — the list endpoint
  exists and nothing in the frontend calls it yet.)
- **The embed is built in one place**, `Sketch.embed_html`, so `data-sketch` is spelled once. Its
  three other half-files: `config/sanitize.py`'s `_img_src_allowed` (which must allow every
  attribute the tag carries — bleach never falls through to `'*'` for a tag with its own callable,
  which is how `class` was silently lost on every chem picture once), the frontend's
  `editor/sketchImage.ts` (a ProseMirror node drops every attribute it has not declared), and
  `MathContent.svelte`'s `img.sketch-drawing` styling. An attribute added in one and missing from
  another is lost somewhere nobody looks.

## The flag

`sketches`, a plain kill switch seeded ON by `moderation/migrations/0042_seed_sketches_flag.py`.
Off, every action on `/api/sketches/` 403s a non-staff caller (reads included) and the frontend's
Sketch button leaves every composer. Pictures already embedded in somebody's comment keep
rendering, because by then they are ordinary media files. Adding or renaming a flag key is a
**three-file** change — `moderation/models.py` + migration, `frontend/src/lib/types/featureFlag.ts`,
`frontend/src/lib/utils/labels.ts` — and the third has been forgotten twice.

## Tests

`sketches/tests.py`, sentence-named, with its own temporary `MEDIA_ROOT` per class so a run never
leaves files under `media/sketches/`.
