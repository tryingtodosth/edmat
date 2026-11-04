"""What a NOTEBOOK may hold: the one module that says what a block is, for every app that has one.

A comment, a solution, a post and a concept article can each be an **ordered list of blocks**
rather than one rich-text field: a paragraph, a display formula, a piece of code, a chemistry
drawing, a whiteboard sketch, a picture. They are genuinely different things to edit (the paragraph
wants the rich editor, the formula a textarea with a live preview, the drawing Ketcher, the sketch
Excalidraw), and one field would have meant one editor pretending to be all of them. The owner's
ask (2026-11-04, `HISTORY.md` §17DI): "multiple different inputs from different input widgets into
a single article … a notebook kind of single comment/solution/article, but for others to be able to
attach a comment also to one of these blocks".

`concepts/blocks.py` was the first and only notebook for a year; this module is that file
generalised, and concepts is now one PROFILE of it (`concepts/blocks.py: CONCEPT_PROFILE`), with
its own two kinds (`pdf`, and `image` backed by `ConceptAsset` rather than `InlineImage`).

## Three things worth knowing before changing this

1. **Every block has an `id`, and the id is what a comment points at.** A short random token,
   allocated here when a client sends none (or a malformed or duplicate one) and KEPT whenever a
   client sends it back — so editing paragraph 3 does not detach the comments written about it, and
   inserting a paragraph above it does not make it paragraph 4 in anybody's eyes but the reader's.
   `community/anchors.py` is the other half: a `Comment.anchor` names a block id and, optionally, a
   quoted passage inside it. Position would have been the obvious key and it is the wrong one —
   `RevisionView` paired concept blocks by position and an insert at the top read as "changed"
   all the way down (the todo that said "block ids fix it").
2. **The body is DERIVED from the blocks, and nothing else writes it while blocks exist.**
   `flatten()` turns a notebook into the Markdown its owner's `body` column has always held:
   paragraphs verbatim, a formula as `\\[ … \\]`, code fenced, every picture as a bracketed caption.
   That is what keeps the dozens of readers of `Comment.body` — notifications, the moderation queue,
   search, the feed excerpt, a course report — correct without each learning about blocks. The
   honest cost: a reader that only knows `body` sees "[Sketch: free-body diagram]" where the picture
   is; every page that DRAWS a comment, a solution or a post reads `blocks` first.
3. **A one-paragraph notebook is not a notebook.** `is_trivial()` is a single markdown block, and
   the owners store that as `blocks=[]` + the body, which is what every row written before today
   already is. So nothing was migrated, a plain comment is byte-for-byte what it was, and a
   paragraph with no blocks is still addressable: `community/anchors.py` calls it block `body`.

## The two halves

* **`clean_blocks(raw, profile=…)` is the write side** — shape, kinds, lengths, ids, every
  referenced row checked to exist in bulk, text sanitized. Raises Django's `ValidationError` with a
  `blocks` key; each owner's serializer turns it into a 400.
* **`expand_blocks(blocks, profile=…, request=…)` is the read side** — the same list with every
  referenced row resolved (a picture's URL and size), one query per referenced TABLE however many
  blocks there are. Resolving per block is the N+1 a thread of forty comments would otherwise ship.

`sanitize_blocks` is the sanitizing half alone — no queries, never raises — and is what each
owner's `save()` calls, so the admin, a seed command and any future write path are covered without
remembering to be (sanitize in `save()`, never only in a serializer; house rule 8).

Stored RAW, deliberately: a `latex` source and a `code` source. Neither is ever rendered as HTML —
KaTeX never produces markup from its input, and the client draws code as a text node — and running
the HTML sanitizer over them would eat the backslashes and angle brackets that are the content.
"""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass, field
from typing import Callable

from django.core.exceptions import ValidationError

from config.sanitize import sanitize_content

MAX_MARKDOWN_CHARS = 100_000
MAX_LATEX_CHARS = 10_000
MAX_CODE_CHARS = 20_000
MAX_CAPTION_CHARS = 300
MAX_ALT_CHARS = 200
MAX_LANGUAGE_CHARS = 20

#: A block id: what a client sends back to keep one, and what `community/anchors.py` accepts.
#: Lowercase alphanumerics, so it is safe in a URL fragment, a CSS selector and a data attribute
#: without escaping. `body`, `statement`, `answer` and `part-<n>` are the IMPLICIT ids anchors use
#: for content that is not a notebook — this pattern deliberately admits the first three and not the
#: last, so an allocated id can never collide with a part (`community/anchors.py`).
BLOCK_ID_RE = re.compile(r'^[a-z0-9]{4,16}$')

#: A code block's language: a label for the reader ("python", "c++", "sql"), never executed and
#: never used to pick a highlighter on the server.
LANGUAGE_RE = re.compile(r'^[a-z0-9+#._-]{0,20}$')

_TAG_RE = re.compile(r'<[^>]+>')


def new_block_id() -> str:
    """Eight lowercase base-32-ish characters: 40 bits, so a collision inside one notebook of at
    most a few hundred blocks is not a thing to design for — `clean_blocks` re-rolls one anyway."""
    alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
    return ''.join(secrets.choice(alphabet) for _ in range(8))


def plain(value, limit: int) -> str:
    """A caption, an alt text: sanitized FIRST and stripped second rather than only stripped, because
    stripping tags out of `<img src=x onerror=…>` leaves the attribute text behind while the
    sanitizer removes the whole element."""
    text = _TAG_RE.sub('', sanitize_content(str(value or ''))).strip()
    return text[:limit]


def refuse(message: str):
    raise ValidationError({'blocks': [message]})


def _as_int(value, field_name: str, index: int):
    try:
        return int(value)
    except (TypeError, ValueError):
        refuse(f'Block {index + 1}: `{field_name}` must be a number.')


# --- references -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Ref:
    """A block field that points at a row in another app's table.

    `load(ids)` returns `{id: row}` for the ones that exist — one query. `describe(row, absolute)`
    is the READ shape put under `expand_as`. `check(row, block)` returns a refusal message or None,
    for the one case a bare existence check is not enough (a concept `image` block naming a PDF).
    Loaders import lazily, so this module never imports an app that imports it back.
    """

    field: str
    expand_as: str
    load: Callable[[set[int]], dict]
    describe: Callable[[object, Callable[[str], str]], dict]
    check: Callable[[object, dict], str | None] | None = None
    missing: str = 'No such picture: {id}.'


def _load_chem(ids):
    from chem.models import ChemDrawing

    return {row.pk: row for row in ChemDrawing.objects.filter(pk__in=ids)}


def _describe_chem(row, absolute):
    return {
        'id': row.pk,
        'image_url': absolute(row.image.url if row.image else ''),
        'label': row.label,
        'width': row.width,
        'height': row.height,
        'source_format': row.source_format,
    }


def _load_sketch(ids):
    from sketches.models import Sketch

    return {row.pk: row for row in Sketch.objects.filter(pk__in=ids)}


def _describe_sketch(row, absolute):
    return {
        'id': row.pk,
        'image_url': absolute(row.image.url if row.image else ''),
        'label': row.label,
        'width': row.width,
        'height': row.height,
    }


def _load_inline_image(ids):
    from community.models import InlineImage

    return {row.pk: row for row in InlineImage.objects.filter(pk__in=ids)}


def _describe_inline_image(row, absolute):
    return {
        'id': row.pk,
        'url': absolute(row.image.url if row.image else ''),
        'width': row.width,
        'height': row.height,
        'original_name': row.original_name,
    }


CHEM_REF = Ref('drawing_id', 'drawing', _load_chem, _describe_chem, missing='No such drawing: {id}.')
SKETCH_REF = Ref('sketch_id', 'sketch', _load_sketch, _describe_sketch, missing='No such sketch: {id}.')
INLINE_IMAGE_REF = Ref('image_id', 'image', _load_inline_image, _describe_inline_image)


# --- kinds -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Kind:
    """One kind of block: how to clean it, how to flatten it, and what row (if any) it points at.

    `clean(block, index)` validates and returns the stored fields (without `id` and `kind`, which
    the caller adds); it raises through `refuse`. `sanitize(block)` is the never-raising half for
    `save()`. `text(block)` is what a reader could search for. `markdown(block)` is the block's
    line in the derived body.
    """

    name: str
    clean: Callable[[dict, int], dict]
    sanitize: Callable[[dict], dict]
    text: Callable[[dict], str]
    markdown: Callable[[dict], str]
    ref: Ref | None = None


def _clean_markdown(block, index):
    body = str(block.get('body') or '')
    if len(body) > MAX_MARKDOWN_CHARS:
        refuse(f'Block {index + 1}: a paragraph is limited to {MAX_MARKDOWN_CHARS} characters.')
    return {'body': sanitize_content(body)}


def _sanitize_markdown(block):
    return {'body': sanitize_content(str(block.get('body') or ''))[:MAX_MARKDOWN_CHARS]}


def _clean_latex(block, index):
    source = str(block.get('source') or '')
    if not source.strip():
        refuse(f'Block {index + 1}: a formula block needs a formula.')
    if len(source) > MAX_LATEX_CHARS:
        refuse(f'Block {index + 1}: a formula is limited to {MAX_LATEX_CHARS} characters.')
    return {'source': source}


def _clean_code(block, index):
    source = str(block.get('source') or '')
    if not source.strip():
        refuse(f'Block {index + 1}: a code block needs some code.')
    if len(source) > MAX_CODE_CHARS:
        refuse(f'Block {index + 1}: a code block is limited to {MAX_CODE_CHARS} characters.')
    language = str(block.get('language') or '').strip().lower()
    if not LANGUAGE_RE.match(language):
        refuse(f'Block {index + 1}: a language is a short name such as "python".')
    return {'language': language, 'source': source}


def _sanitize_code(block):
    language = str(block.get('language') or '').strip().lower()
    return {
        'language': language if LANGUAGE_RE.match(language) else '',
        'source': str(block.get('source') or '')[:MAX_CODE_CHARS],
    }


def _picture_cleaner(ref_field: str, *, with_alt: bool):
    def clean(block, index):
        out = {ref_field: _as_int(block.get(ref_field), ref_field, index)}
        if with_alt:
            out['alt'] = plain(block.get('alt'), MAX_ALT_CHARS)
        out['caption'] = plain(block.get('caption'), MAX_CAPTION_CHARS)
        return out

    def sanitize(block):
        out = {ref_field: block.get(ref_field)}
        if with_alt:
            out['alt'] = plain(block.get('alt'), MAX_ALT_CHARS)
        out['caption'] = plain(block.get('caption'), MAX_CAPTION_CHARS)
        return out

    return clean, sanitize


def _caption_text(block):
    return ' '.join(str(block.get(k) or '') for k in ('alt', 'caption')).strip()


def _picture_markdown(word: str):
    def markdown(block):
        label = (block.get('caption') or block.get('alt') or '').strip()
        return f'*[{word}: {label}]*' if label else f'*[{word}]*'

    return markdown


def _fence(block):
    source = str(block.get('source') or '')
    # A fence longer than any run of backticks inside the code, so the code cannot close it.
    longest = max((len(run) for run in re.findall(r'`+', source)), default=0)
    ticks = '`' * max(3, longest + 1)
    return f'{ticks}{block.get("language") or ""}\n{source}\n{ticks}'


_chem_clean, _chem_sanitize = _picture_cleaner('drawing_id', with_alt=False)
_sketch_clean, _sketch_sanitize = _picture_cleaner('sketch_id', with_alt=False)
_image_clean, _image_sanitize = _picture_cleaner('image_id', with_alt=True)

MARKDOWN = Kind(
    'markdown',
    _clean_markdown,
    _sanitize_markdown,
    text=lambda b: _TAG_RE.sub(' ', str(b.get('body') or '')),
    markdown=lambda b: str(b.get('body') or ''),
)
LATEX = Kind(
    'latex',
    _clean_latex,
    lambda b: {'source': str(b.get('source') or '')[:MAX_LATEX_CHARS]},
    text=lambda b: str(b.get('source') or ''),
    markdown=lambda b: f'\\[{b.get("source") or ""}\\]',
)
CODE = Kind(
    'code',
    _clean_code,
    _sanitize_code,
    text=lambda b: str(b.get('source') or ''),
    markdown=_fence,
)
CHEM = Kind('chem', _chem_clean, _chem_sanitize, _caption_text, _picture_markdown('Chemistry'), CHEM_REF)
SKETCH = Kind('sketch', _sketch_clean, _sketch_sanitize, _caption_text, _picture_markdown('Sketch'), SKETCH_REF)
IMAGE = Kind('image', _image_clean, _image_sanitize, _caption_text, _picture_markdown('Picture'), INLINE_IMAGE_REF)


@dataclass(frozen=True)
class Profile:
    """Which kinds one owner accepts, and how much of them. A comment is not a book."""

    name: str
    kinds: dict[str, Kind]
    max_blocks: int
    #: Characters of TEXT (paragraphs, formulas, code) across the whole notebook. Bounded because the
    #: list is a JSON column a single request writes whole.
    max_text_chars: int
    extra: dict = field(default_factory=dict)


COMMON_KINDS = {k.name: k for k in (MARKDOWN, LATEX, CODE, CHEM, SKETCH, IMAGE)}

#: A comment or a reply. The cap is the existing comment body's 8 000 characters, times the room a
#: formula and a listing need on top — a notebook comment is a comment that shows its working.
COMMENT_PROFILE = Profile('comment', COMMON_KINDS, max_blocks=40, max_text_chars=30_000)
#: A hint, an answer or a solution (`exercises.SolutionEntry`).
SOLUTION_PROFILE = Profile('solution', COMMON_KINDS, max_blocks=100, max_text_chars=100_000)
#: A post or a question on the board (`activity.Post`).
POST_PROFILE = Profile('post', COMMON_KINDS, max_blocks=60, max_text_chars=60_000)


# --- the write side ----------------------------------------------------------------------------


def clean_blocks(raw, *, profile: Profile) -> list[dict]:
    """Validate and sanitize an incoming block list; returns the list to store.

    Unknown keys are dropped — the stored shape is exactly what the kind says it is, so a client
    cannot smuggle a field through the JSON column that a later reader would have to defend against.
    """
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        refuse('The content must be a list of blocks.')
    if len(raw) > profile.max_blocks:
        refuse(f'At most {profile.max_blocks} blocks.')

    cleaned: list[dict] = []
    seen_ids: set[str] = set()
    wanted: dict[Ref, dict[int, list[dict]]] = {}
    text_chars = 0

    for index, block in enumerate(raw):
        if not isinstance(block, dict):
            refuse(f'Block {index + 1} is not a block.')
        kind = profile.kinds.get(block.get('kind'))
        if kind is None:
            refuse(f'Block {index + 1}: unknown kind {block.get("kind")!r}.')
        fields = kind.clean(block, index)
        if kind.ref is None:
            text_chars += sum(len(v) for k, v in fields.items() if k in ('body', 'source'))
        block_id = _keep_or_allocate(block.get('id'), seen_ids)
        row = {'id': block_id, 'kind': kind.name, **fields}
        cleaned.append(row)
        if kind.ref is not None:
            wanted.setdefault(kind.ref, {}).setdefault(row[kind.ref.field], []).append(row)

    if text_chars > profile.max_text_chars:
        refuse(f'At most {profile.max_text_chars} characters of text in one piece.')

    for ref, by_id in wanted.items():
        rows = ref.load(set(by_id))
        for ref_id in sorted(by_id):
            row = rows.get(ref_id)
            if row is None:
                refuse(ref.missing.format(id=ref_id))
            if ref.check is not None:
                for block in by_id[ref_id]:
                    message = ref.check(row, block)
                    if message:
                        refuse(message)
    return cleaned


def _keep_or_allocate(candidate, seen: set[str]) -> str:
    """The client's id when it is well-formed and not already used in this list; a new one if not.

    A DUPLICATE is re-rolled rather than refused: a client that duplicated a block by copying it
    (the obvious way to write "copy this block") has done nothing wrong, and the comments on the
    original must stay on the original — which the first occurrence keeping the id guarantees.
    """
    if isinstance(candidate, str) and BLOCK_ID_RE.match(candidate) and candidate not in seen:
        seen.add(candidate)
        return candidate
    while True:
        fresh = new_block_id()
        if fresh not in seen:
            seen.add(fresh)
            return fresh


def sanitize_blocks(blocks, *, profile: Profile) -> list[dict]:
    """The sanitizing half of `clean_blocks`: no validation, no queries, never raises.

    Drops what it does not recognise instead of raising, because by the time a row reaches `save()`
    the request path has already refused a malformed list, and a `save()` that could raise would
    stop the admin and a seed command writing a row they had not validated themselves. Ids are kept
    or allocated exactly as the write side does, so a row saved only through the ORM still has
    addressable blocks.
    """
    if not isinstance(blocks, list):
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for block in blocks[: profile.max_blocks]:
        if not isinstance(block, dict):
            continue
        kind = profile.kinds.get(block.get('kind'))
        if kind is None:
            continue
        out.append({'id': _keep_or_allocate(block.get('id'), seen), 'kind': kind.name, **kind.sanitize(block)})
    return out


def has_pictures(blocks) -> bool:
    """Whether a notebook shows any picture: a drawing, a sketch, an image or PDF block, or an `<img>`
    inside a paragraph. What `community/signals.py`'s minor-band hold asks — a derived body writes a
    picture block as "[Sketch: …]", so looking for `<img` in the body alone would let every picture
    in a notebook past the rule that holds pictures on a children's thread."""
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        if block.get('kind') in ('chem', 'sketch', 'image', 'pdf'):
            return True
        if block.get('kind') == 'markdown' and '<img' in str(block.get('body') or ''):
            return True
    return False


def is_trivial(blocks) -> bool:
    """No blocks, or exactly one paragraph: content its owner stores as a plain body (point 3)."""
    return not blocks or (len(blocks) == 1 and isinstance(blocks[0], dict) and blocks[0].get('kind') == 'markdown')


def flatten(blocks, *, profile: Profile) -> str:
    """The derived body (point 2): every block's Markdown line, separated by a blank line."""
    parts = []
    for block in blocks or []:
        kind = profile.kinds.get(block.get('kind')) if isinstance(block, dict) else None
        if kind is not None:
            line = kind.markdown(block).strip()
            if line:
                parts.append(line)
    return '\n\n'.join(parts)


def plain_text(blocks, *, profile: Profile) -> str:
    """Everything a reader could search for, flattened — tags stripped, formula and code sources
    as written, every caption and alt text."""
    parts = []
    for block in blocks or []:
        kind = profile.kinds.get(block.get('kind')) if isinstance(block, dict) else None
        if kind is not None:
            text = kind.text(block).strip()
            if text:
                parts.append(text)
    return '\n'.join(parts)


def block_texts(blocks, *, profile: Profile) -> dict[str, str]:
    """`{block id: its plain text}` — what `community/anchors.py` checks an anchor's block against."""
    out: dict[str, str] = {}
    for block in blocks or []:
        if not isinstance(block, dict) or not block.get('id'):
            continue
        kind = profile.kinds.get(block.get('kind'))
        out[str(block['id'])] = kind.text(block) if kind is not None else ''
    return out


def apply_notebook(instance, *, profile: Profile) -> None:
    """What every owner's `save()` does with its `blocks` and `body`, in one place (three owners:
    house rule 13's third strike). Sanitizes the blocks; a trivial notebook collapses into the body
    (point 3); any other derives the body (point 2). The caller still sanitizes `body` itself, as it
    always has, because that is also what a plain row needs."""
    instance.blocks = sanitize_blocks(instance.blocks, profile=profile)
    if is_trivial(instance.blocks):
        if instance.blocks:
            instance.body = instance.blocks[0]['body']
        instance.blocks = []
    else:
        instance.body = flatten(instance.blocks, profile=profile)


def with_blocks(update_fields):
    """`save(update_fields=[…, 'body'])` must also write `blocks`, which `apply_notebook` may have
    just changed; returns the widened list (or None, untouched)."""
    if update_fields is not None and 'body' in update_fields and 'blocks' not in update_fields:
        return [*update_fields, 'blocks']
    return update_fields


def clean_blocks_for_api(value, *, profile: Profile):
    """`clean_blocks` for a DRF serializer: Django's `ValidationError` turned into DRF's, so a
    malformed notebook is a 400 with the reason, never a 500."""
    import json

    from rest_framework import serializers

    if isinstance(value, str):
        # A multipart form (a post with a picture) carries the list as JSON text.
        try:
            value = json.loads(value) if value.strip() else []
        except ValueError:
            raise serializers.ValidationError(['The content must be a list of blocks.'])
    try:
        return clean_blocks(value, profile=profile)
    except ValidationError as exc:
        detail = exc.message_dict.get('blocks') if hasattr(exc, 'message_dict') else None
        raise serializers.ValidationError(detail or exc.messages)


# --- the read side -----------------------------------------------------------------------------


def expand_blocks(blocks, *, profile: Profile, request=None, cache: dict | None = None) -> list[dict]:
    """The READ shape: the stored blocks plus the rows they point at.

    A reference that no longer resolves gets `None` rather than disappearing — the block stays where
    its author put it and the reader sees a gap, not a notebook that silently changed shape.

    `cache` is for a caller expanding MANY notebooks (a thread): pass the same dict to every call
    and use `prefetch()` first, and the whole thread costs one query per referenced table.
    """
    blocks = blocks or []
    if cache is None:
        cache = {}
        prefetch([blocks], profile=profile, cache=cache)
    else:
        prefetch([blocks], profile=profile, cache=cache)

    def absolute(url: str) -> str:
        if not url:
            return ''
        return request.build_absolute_uri(url) if request is not None else url

    out: list[dict] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        row = dict(block)
        kind = profile.kinds.get(row.get('kind'))
        if kind is not None and kind.ref is not None:
            target = cache.get(kind.ref, {}).get(row.get(kind.ref.field))
            row[kind.ref.expand_as] = kind.ref.describe(target, absolute) if target is not None else None
        out.append(row)
    return out


def prefetch(notebooks, *, profile: Profile, cache: dict) -> None:
    """Load, into `cache`, every referenced row of every notebook given that is not loaded yet —
    one query per referenced table."""
    wanted: dict[Ref, set[int]] = {}
    for blocks in notebooks:
        for block in blocks or []:
            if not isinstance(block, dict):
                continue
            kind = profile.kinds.get(block.get('kind'))
            if kind is None or kind.ref is None:
                continue
            ref_id = block.get(kind.ref.field)
            if isinstance(ref_id, int) and ref_id not in cache.get(kind.ref, {}):
                wanted.setdefault(kind.ref, set()).add(ref_id)
    for ref, ids in wanted.items():
        cache.setdefault(ref, {}).update(ref.load(ids))


__all__ = [
    'BLOCK_ID_RE',
    'COMMENT_PROFILE',
    'COMMON_KINDS',
    'POST_PROFILE',
    'SOLUTION_PROFILE',
    'Kind',
    'Profile',
    'Ref',
    'apply_notebook',
    'block_texts',
    'clean_blocks_for_api',
    'clean_blocks',
    'expand_blocks',
    'flatten',
    'has_pictures',
    'is_trivial',
    'new_block_id',
    'plain',
    'plain_text',
    'prefetch',
    'refuse',
    'sanitize_blocks',
    'with_blocks',
]
