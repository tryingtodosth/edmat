"""What a concept article's content may be — the ONE place that says so.

An article is an **ordered list of blocks**, not one rich-text field, and this module is the whole
of that decision. A paragraph, a display formula, a chemistry drawing, a PDF and a picture are five
genuinely different things to edit: the paragraph wants the rich editor the rest of this app
already has, the formula wants a textarea with a live preview, the drawing wants Ketcher and the
two files want an upload with a caption. One field would have meant one editor pretending to be all
five, and a reader's page rebuilt by parsing HTML for what it happened to contain.

Storage is a plain JSON list on the revision, so a block's shape is a fact about this module and
nothing else has to know it. The two halves that matter:

* **`clean_blocks` is the write side** — it validates the shape, refuses an unknown kind, bounds
  every length, checks that every referenced drawing and asset really exists, and sanitizes the
  text. It raises Django's own `ValidationError`; `serializers.py` catches it and re-raises the DRF
  one, so a malformed body is a 400 with a `blocks` key rather than a 500.
* **`expand_blocks` is the read side** — it hands back the same blocks with the referenced rows
  resolved (a drawing's picture URL, an asset's URL and size), bulk-fetched in at most two queries
  no matter how many blocks there are. Resolving per block is the N+1 this app would otherwise ship
  with on its busiest endpoint, and `ConceptExpandQueryTests` pins the count.

`sanitize_blocks` is the sanitizing half alone, and it is what `ConceptRevision.save()` calls, so
the admin, the seed command and any future write path are covered without remembering to be (the
house rule: sanitize in `save()`, never only in a serializer). It never raises and never touches the
database — the existence checks that DO need a query belong to the request path, where a missing row
is a 400 somebody can act on rather than an exception in the middle of a save.
"""

from __future__ import annotations

import re

from django.core.exceptions import ValidationError

from config.sanitize import sanitize_content

#: An article longer than this is a book, not a page. Bounded because the list is a JSON column
#: that a single request writes whole: without a cap, one save can make every later read expensive.
MAX_BLOCKS = 200

BLOCK_KINDS = ('markdown', 'latex', 'chem', 'pdf', 'image')

MAX_MARKDOWN_CHARS = 100_000
MAX_LATEX_CHARS = 10_000
MAX_CAPTION_CHARS = 300
MAX_ALT_CHARS = 200

_TAG_RE = re.compile(r'<[^>]+>')

#: `[[slug]]` and `[[slug|label]]` inside a markdown block: a link to another concept, written the
#: way every wiki writes one, and harvested into real link rows on publish
#: (`services.harvest_body_links`) so backlinks exist without anybody filing them.
#:
#: **Mirrored in `frontend/src/lib/utils/renderContent.ts`** — the same expression, applied there
#: AFTER the maths extraction so a `\[\[` inside stashed LaTeX is never touched. The two copies are
#: flagged in each other's comments because neither can be derived from the other (house rule 13).
#: The slug half is deliberately the strict `slugify` alphabet: anything else is prose that happens
#: to contain brackets, and turning it into a broken link would be worse than leaving it as text.
WIKI_LINK_RE = re.compile(r'\[\[([a-z0-9][a-z0-9-]*)(?:\|[^\]]*)?\]\]')


def _plain(value, limit: int) -> str:
    """A caption, an alt text or a summary: sanitized like everything else here, then flattened.

    Sanitized FIRST and stripped second rather than only stripped, because stripping tags out of
    `<img src=x onerror=…>` leaves the attribute text behind while the sanitizer removes the whole
    element — and because "it renders as plain text today" is exactly the assumption that stops
    being true when somebody writes a second client.
    """
    text = _TAG_RE.sub('', sanitize_content(str(value or ''))).strip()
    return text[:limit]


def _refuse(message: str):
    raise ValidationError({'blocks': [message]})


def _as_int(value, field: str):
    try:
        return int(value)
    except (TypeError, ValueError):
        _refuse(f'A block\'s `{field}` must be a number.')


def clean_blocks(raw, *, user=None) -> list[dict]:
    """Validate and sanitize an incoming block list; returns the list to store.

    Unknown keys are dropped rather than kept — the stored shape is exactly what this module says it
    is, so a client cannot smuggle a field through the JSON column that a later reader would then
    have to defend against. A missing required key, an unknown kind, an over-long body or a
    reference to a row that does not exist is a refusal with a `blocks` key.

    `user` is accepted and deliberately NOT used to narrow which drawings and assets may be
    referenced: a `ChemDrawing` is public content the moment it is embedded anywhere, and a
    `ConceptAsset` is only reachable by id from a client that was handed the id. Naming the
    parameter keeps the seam where a per-author rule would go if one is ever wanted, and saying so
    here is cheaper than a reader wondering why it is ignored.
    """
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        _refuse('The content must be a list of blocks.')
    if len(raw) > MAX_BLOCKS:
        _refuse(f'At most {MAX_BLOCKS} blocks in one article.')

    cleaned: list[dict] = []
    drawing_ids: set[int] = set()
    asset_ids: dict[int, str] = {}

    for index, block in enumerate(raw):
        if not isinstance(block, dict):
            _refuse(f'Block {index + 1} is not a block.')
        kind = block.get('kind')
        if kind not in BLOCK_KINDS:
            _refuse(f'Block {index + 1}: unknown kind {kind!r}.')

        if kind == 'markdown':
            body = str(block.get('body') or '')
            if len(body) > MAX_MARKDOWN_CHARS:
                _refuse(f'Block {index + 1}: a paragraph is limited to {MAX_MARKDOWN_CHARS} characters.')
            cleaned.append({'kind': 'markdown', 'body': sanitize_content(body)})

        elif kind == 'latex':
            source = str(block.get('source') or '')
            if not source.strip():
                _refuse(f'Block {index + 1}: a formula block needs a formula.')
            if len(source) > MAX_LATEX_CHARS:
                _refuse(f'Block {index + 1}: a formula is limited to {MAX_LATEX_CHARS} characters.')
            # Stored RAW, and that is safe rather than an oversight: the client renders it as
            # `\[ … \]` through KaTeX, which never produces markup from its input, and running the
            # HTML sanitizer over it would eat the backslashes that make it a formula at all.
            cleaned.append({'kind': 'latex', 'source': source})

        elif kind == 'chem':
            drawing_id = _as_int(block.get('drawing_id'), 'drawing_id')
            drawing_ids.add(drawing_id)
            cleaned.append(
                {
                    'kind': 'chem',
                    'drawing_id': drawing_id,
                    'caption': _plain(block.get('caption'), MAX_CAPTION_CHARS),
                }
            )

        elif kind == 'pdf':
            asset_id = _as_int(block.get('asset_id'), 'asset_id')
            asset_ids[asset_id] = 'pdf'
            cleaned.append(
                {
                    'kind': 'pdf',
                    'asset_id': asset_id,
                    'caption': _plain(block.get('caption'), MAX_CAPTION_CHARS),
                }
            )

        else:  # image
            asset_id = _as_int(block.get('asset_id'), 'asset_id')
            asset_ids[asset_id] = 'image'
            cleaned.append(
                {
                    'kind': 'image',
                    'asset_id': asset_id,
                    'alt': _plain(block.get('alt'), MAX_ALT_CHARS),
                    'caption': _plain(block.get('caption'), MAX_CAPTION_CHARS),
                }
            )

    _check_references(drawing_ids, asset_ids)
    return cleaned


def _check_references(drawing_ids: set[int], asset_ids: dict[int, str]) -> None:
    """Every referenced drawing and asset exists, and an asset is of the kind its block claims.

    Two bulk queries at most, not one per block. The kind check is the one worth spelling out: an
    `image` block pointing at a PDF would render as a broken picture on every reader's page, and the
    id is the only thing the client sends — so this is where the mismatch has to be caught.
    """
    if drawing_ids:
        from chem.models import ChemDrawing

        found = set(
            ChemDrawing.objects.filter(pk__in=drawing_ids).values_list('pk', flat=True)
        )
        missing = sorted(drawing_ids - found)
        if missing:
            _refuse(f'No such drawing: {missing[0]}.')

    if asset_ids:
        from .models import ConceptAsset

        rows = dict(
            ConceptAsset.objects.filter(pk__in=asset_ids).values_list('pk', 'kind')
        )
        for asset_id, wanted in asset_ids.items():
            actual = rows.get(asset_id)
            if actual is None:
                _refuse(f'No such file: {asset_id}.')
            if actual != wanted:
                _refuse(f'File {asset_id} is a {actual}, not a {wanted}.')


def sanitize_blocks(blocks) -> list[dict]:
    """The sanitizing half of `clean_blocks`, with no validation and no queries — what
    `ConceptRevision.save()` runs, so every write path is covered and not just the API one.

    Silently drops anything it does not recognise instead of raising: by the time a row reaches
    `save()` the request path has already refused a malformed list with a 400, and a `save()` that
    could raise would make the admin and the seed command unable to write a row they had not
    themselves validated.
    """
    if not isinstance(blocks, list):
        return []
    out: list[dict] = []
    for block in blocks[:MAX_BLOCKS]:
        if not isinstance(block, dict):
            continue
        kind = block.get('kind')
        if kind == 'markdown':
            out.append({'kind': 'markdown', 'body': sanitize_content(str(block.get('body') or ''))[:MAX_MARKDOWN_CHARS]})
        elif kind == 'latex':
            out.append({'kind': 'latex', 'source': str(block.get('source') or '')[:MAX_LATEX_CHARS]})
        elif kind == 'chem':
            out.append(
                {
                    'kind': 'chem',
                    'drawing_id': block.get('drawing_id'),
                    'caption': _plain(block.get('caption'), MAX_CAPTION_CHARS),
                }
            )
        elif kind == 'pdf':
            out.append(
                {
                    'kind': 'pdf',
                    'asset_id': block.get('asset_id'),
                    'caption': _plain(block.get('caption'), MAX_CAPTION_CHARS),
                }
            )
        elif kind == 'image':
            out.append(
                {
                    'kind': 'image',
                    'asset_id': block.get('asset_id'),
                    'alt': _plain(block.get('alt'), MAX_ALT_CHARS),
                    'caption': _plain(block.get('caption'), MAX_CAPTION_CHARS),
                }
            )
    return out


def plain_text(blocks) -> str:
    """Everything a reader could search for, flattened — what `ConceptRevision.search_text` holds.

    Markdown bodies with their tags stripped, formula sources as written, and every caption and alt
    text. The formula sources are in deliberately: `?q=nabla` finding the article whose only mention
    of the word is inside `\\nabla` is more useful than not finding it, and the alternative is a
    reader being told a concept they can see on the page does not exist.
    """
    parts: list[str] = []
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        kind = block.get('kind')
        if kind == 'markdown':
            parts.append(_TAG_RE.sub(' ', str(block.get('body') or '')))
        elif kind == 'latex':
            parts.append(str(block.get('source') or ''))
        for key in ('alt', 'caption'):
            value = block.get(key)
            if value:
                parts.append(str(value))
    return '\n'.join(part.strip() for part in parts if part and part.strip())


def mentioned_slugs(blocks) -> set[str]:
    """Every `[[slug]]` written in a markdown block of this content.

    Markdown bodies ONLY. A caption is a label under a picture and a formula is a formula; a link
    inside either would have nowhere sensible to render, and harvesting one would create a link row
    a reader could never see the origin of.
    """
    found: set[str] = set()
    for block in blocks or []:
        if isinstance(block, dict) and block.get('kind') == 'markdown':
            found.update(WIKI_LINK_RE.findall(str(block.get('body') or '')))
    return found


def expand_blocks(blocks, *, request=None) -> list[dict]:
    """The READ shape: the stored blocks plus the rows they point at, in at most two queries.

    A `chem` block gains `drawing` (its picture's URL, label, size and source format) and a `pdf` or
    `image` block gains `asset` (URL, original name, bytes, dimensions). A reference that no longer
    resolves gets `None` rather than disappearing — the block stays where the author put it, and a
    reader sees a gap where something was rather than an article that silently changed shape.

    `request` is optional and only builds absolute URLs. It matters in development, where the page
    is served by Vite and a relative `/media/…` would resolve against the wrong origin — the exact
    bug `chem.serializers` records having fixed the same way.
    """
    blocks = blocks or []
    drawing_ids = {b.get('drawing_id') for b in blocks if isinstance(b, dict) and b.get('kind') == 'chem'}
    drawing_ids.discard(None)
    asset_ids = {
        b.get('asset_id')
        for b in blocks
        if isinstance(b, dict) and b.get('kind') in ('pdf', 'image')
    }
    asset_ids.discard(None)

    def absolute(url: str) -> str:
        if not url:
            return ''
        return request.build_absolute_uri(url) if request is not None else url

    drawings: dict[int, dict] = {}
    if drawing_ids:
        from chem.models import ChemDrawing

        for row in ChemDrawing.objects.filter(pk__in=drawing_ids):
            drawings[row.pk] = {
                'id': row.pk,
                'image_url': absolute(row.image.url if row.image else ''),
                'label': row.label,
                'width': row.width,
                'height': row.height,
                'source_format': row.source_format,
            }

    assets: dict[int, dict] = {}
    if asset_ids:
        from .models import ConceptAsset

        for row in ConceptAsset.objects.filter(pk__in=asset_ids):
            assets[row.pk] = {
                'id': row.pk,
                'kind': row.kind,
                'url': absolute(row.file.url if row.file else ''),
                'original_name': row.original_name,
                'size_bytes': row.size_bytes,
                'width': row.width,
                'height': row.height,
            }

    out: list[dict] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        row = dict(block)
        if row.get('kind') == 'chem':
            row['drawing'] = drawings.get(row.get('drawing_id'))
        elif row.get('kind') in ('pdf', 'image'):
            row['asset'] = assets.get(row.get('asset_id'))
        out.append(row)
    return out


__all__ = [
    'MAX_BLOCKS',
    'BLOCK_KINDS',
    'WIKI_LINK_RE',
    'clean_blocks',
    'sanitize_blocks',
    'plain_text',
    'mentioned_slugs',
    'expand_blocks',
]
