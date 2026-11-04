"""What a concept article's content may be — one PROFILE of the shared notebook (`config/blocks.py`).

Until 2026-11-04 this file was the whole of the block machinery; it is now the concept-specific
half only: the two kinds that are backed by a `ConceptAsset` (a `pdf`, and an `image` — which on a
comment or a solution is an `InlineImage` instead), the `[[slug]]` wiki links, and the two-query
pin on expanding an article. Every block gained an `id` the same day, which is what lets a comment
point at one paragraph of an article (`community/anchors.py`), and the profile gained `code` and
`sketch` (the "no dedicated sketch block kind" todo). The reasoning below is the original file's,
and it is still why an article is a list of blocks at all:

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

from config import blocks as notebook
from config.blocks import Kind, Profile, Ref, plain, refuse

#: An article longer than this is a book, not a page.
MAX_BLOCKS = 200

# The limits stay importable from here, where `import_concepts` and older callers look for them;
# their values are the shared module's.
MAX_MARKDOWN_CHARS = notebook.MAX_MARKDOWN_CHARS
MAX_LATEX_CHARS = notebook.MAX_LATEX_CHARS
MAX_CAPTION_CHARS = notebook.MAX_CAPTION_CHARS
MAX_ALT_CHARS = notebook.MAX_ALT_CHARS

#: `[[slug]]` and `[[slug|label]]` inside a markdown block: a link to another concept, written the
#: way every wiki writes one, and harvested into real link rows on publish
#: (`services.harvest_body_links`) so backlinks exist without anybody filing them.
#:
#: **Mirrored in `frontend/src/lib/utils/renderContent.ts`** — the same expression, applied there
#: AFTER the maths extraction so a `\[\[` inside stashed LaTeX is never touched. The two copies are
#: flagged in each other's comments because neither can be derived from the other (house rule 13).
WIKI_LINK_RE = re.compile(r'\[\[([a-z0-9][a-z0-9-]*)(?:\|[^\]]*)?\]\]')


def _load_assets(ids):
    from .models import ConceptAsset

    return {row.pk: row for row in ConceptAsset.objects.filter(pk__in=ids)}


def _describe_asset(row, absolute):
    return {
        'id': row.pk,
        'kind': row.kind,
        'url': absolute(row.file.url if row.file else ''),
        'original_name': row.original_name,
        'size_bytes': row.size_bytes,
        'width': row.width,
        'height': row.height,
    }


def _asset_kind_check(row, block):
    """An `image` block pointing at a PDF would render as a broken picture on every reader's page,
    and the id is the only thing the client sends — so this is where the mismatch is caught."""
    if row.kind != block['kind']:
        return f'File {row.pk} is a {row.kind}, not a {block["kind"]}.'
    return None


ASSET_REF = Ref('asset_id', 'asset', _load_assets, _describe_asset, _asset_kind_check, missing='No such file: {id}.')


def _asset_cleaner(with_alt: bool):
    def clean(block, index):
        try:
            asset_id = int(block.get('asset_id'))
        except (TypeError, ValueError):
            refuse(f'Block {index + 1}: `asset_id` must be a number.')
        out = {'asset_id': asset_id}
        if with_alt:
            out['alt'] = plain(block.get('alt'), MAX_ALT_CHARS)
        out['caption'] = plain(block.get('caption'), MAX_CAPTION_CHARS)
        return out

    def sanitize(block):
        out = {'asset_id': block.get('asset_id')}
        if with_alt:
            out['alt'] = plain(block.get('alt'), MAX_ALT_CHARS)
        out['caption'] = plain(block.get('caption'), MAX_CAPTION_CHARS)
        return out

    return clean, sanitize


_image_clean, _image_sanitize = _asset_cleaner(True)
_pdf_clean, _pdf_sanitize = _asset_cleaner(False)


def _caption_text(block):
    return ' '.join(str(block.get(k) or '') for k in ('alt', 'caption')).strip()


CONCEPT_IMAGE = Kind(
    'image', _image_clean, _image_sanitize, _caption_text, lambda b: f'*[Picture: {b.get("caption") or b.get("alt") or ""}]*', ASSET_REF
)
CONCEPT_PDF = Kind('pdf', _pdf_clean, _pdf_sanitize, _caption_text, lambda b: f'*[PDF: {b.get("caption") or ""}]*', ASSET_REF)

BLOCK_KINDS = ('markdown', 'latex', 'code', 'chem', 'sketch', 'pdf', 'image')

CONCEPT_PROFILE = Profile(
    'concept',
    {**notebook.COMMON_KINDS, 'image': CONCEPT_IMAGE, 'pdf': CONCEPT_PDF},
    max_blocks=MAX_BLOCKS,
    max_text_chars=MAX_BLOCKS * notebook.MAX_MARKDOWN_CHARS,
)


def clean_blocks(raw, *, user=None) -> list[dict]:
    """Validate and sanitize an incoming block list; returns the list to store.

    `user` is accepted and deliberately NOT used to narrow which drawings and assets may be
    referenced: a `ChemDrawing` is public content the moment it is embedded anywhere, and a
    `ConceptAsset` is only reachable by id from a client that was handed the id. Naming the
    parameter keeps the seam where a per-author rule would go if one is ever wanted.
    """
    return notebook.clean_blocks(raw, profile=CONCEPT_PROFILE)


def sanitize_blocks(blocks) -> list[dict]:
    """What `ConceptRevision.save()` runs — see `config/blocks.py: sanitize_blocks`."""
    return notebook.sanitize_blocks(blocks, profile=CONCEPT_PROFILE)


def plain_text(blocks) -> str:
    """Everything a reader could search for — what `ConceptRevision.search_text` holds. Formula
    sources are in deliberately: `?q=nabla` finding the article whose only mention of the word is
    inside `\\nabla` is more useful than not finding it."""
    return notebook.plain_text(blocks, profile=CONCEPT_PROFILE)


def mentioned_slugs(blocks) -> set[str]:
    """Every `[[slug]]` written in a markdown block. Markdown bodies ONLY: a caption is a label under
    a picture and a formula is a formula; a link inside either would have nowhere to render."""
    found: set[str] = set()
    for block in blocks or []:
        if isinstance(block, dict) and block.get('kind') == 'markdown':
            found.update(WIKI_LINK_RE.findall(str(block.get('body') or '')))
    return found


def without_ids(blocks) -> list[dict]:
    """The blocks with their ids left out — for asking "is this the same TEXT?". Two revisions with
    identical content and different ids are the same page to a reader; `import_concepts` asks
    exactly that question of every file."""
    return [{k: v for k, v in b.items() if k != 'id'} for b in blocks or [] if isinstance(b, dict)]


def inherit_ids(blocks, previous) -> list[dict]:
    """Give each block without an id the id of the block at the same position in `previous`, when
    that one is the same kind — so a NEW revision written without ids (a file, an older client)
    keeps the comments on its paragraphs attached, the way an editor that sends ids back does."""
    out = []
    taken = {b.get('id') for b in blocks or [] if isinstance(b, dict) and b.get('id')}
    for index, block in enumerate(blocks or []):
        row = dict(block)
        if not row.get('id') and index < len(previous or []):
            before = previous[index]
            if isinstance(before, dict) and before.get('kind') == row.get('kind') and before.get('id') not in taken:
                row['id'] = before['id']
                taken.add(before['id'])
        out.append(row)
    return out


def expand_blocks(blocks, *, request=None) -> list[dict]:
    """The READ shape: one query per referenced table (drawings, sketches, assets), however many
    blocks — `ConceptExpandQueryTests` pins it."""
    return notebook.expand_blocks(blocks, profile=CONCEPT_PROFILE, request=request)


__all__ = [
    'MAX_BLOCKS',
    'MAX_MARKDOWN_CHARS',
    'MAX_LATEX_CHARS',
    'BLOCK_KINDS',
    'CONCEPT_PROFILE',
    'WIKI_LINK_RE',
    'clean_blocks',
    'sanitize_blocks',
    'plain_text',
    'mentioned_slugs',
    'expand_blocks',
    'inherit_ids',
    'without_ids',
]
