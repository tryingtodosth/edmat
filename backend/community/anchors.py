"""What a comment may be ABOUT, below the level of "this thread": one block, or a passage inside it.

The owner's ask (2026-11-04, `HISTORY.md` §17DI): "for others to be able to attach a comment also
to one of these blocks (maybe be even more specific)". A `Comment.anchor` is that, and this module
is the ONE place that decides whether an anchor is legal (root `CLAUDE.md` boundary 2) — every
thread endpoint saves through `CommentSerializer`, which asks here, so eighteen endpoints learned it
without one of them changing.

## The shape

    {"block": "k3m9qx2a", "quote": "the derivative is zero", "prefix": "so at the top ", "suffix": "."}

* `block` — a block id (`config/blocks.py`), or one of the IMPLICIT ids content that is not a
  notebook answers to: `body` for a plain comment, solution or post; `statement`, `answer` and
  `part-<pk>` for an exercise. So a sentence of a plain comment or of an exercise statement can be
  commented on exactly like a block of a notebook — "even more specific" applies everywhere, not
  only to the content written after today.
* `quote` / `prefix` / `suffix` — optional: the passage a reader selected, and a few characters
  either side of it so the client can find the right occurrence of a phrase that appears twice.
  This is the W3C Web Annotation `TextQuoteSelector`, chosen over character offsets because an
  offset into a paragraph is wrong after the first edit above it, while a quote either still
  appears or honestly does not.

## Which subject

A REPLY's anchor names a block of the comment it replies to ("about your second step: …"); a
top-level comment's anchor names a block of the thread's target (the exercise statement, the
solution, the article). One rule, no flag: the parent is what a reply answers.

## What the server can and cannot check

The block is checked: it must exist in the subject's current content, or the anchor is refused
(`no_such_block`) — an anchor born detached is a bug in the client, not a comment. The QUOTE is
deliberately NOT checked against the stored text: a reader selects RENDERED text (KaTeX output,
Markdown already turned into bold and lists), and the server cannot reproduce that rendering to
compare. So a quote is bounded and stripped of markup here, and it is the client, which has the
rendered DOM, that says whether the passage can still be found — and says so in words when it
cannot, rather than highlighting the wrong thing.

On read, `reading()` adds `state`: `attached` while the block still exists, `detached` once its
author has deleted it — the comment then shows what it quoted under "on a part that has since
been removed", rather than pointing at nothing or vanishing (house rule 12's reasoning: a thread
must not lose its place). A quote taken from a comment that is now removed or held is blanked, so
an anchor never becomes the way a removed comment's words stay on the page.
"""

from __future__ import annotations

import re

from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from config.blocks import (
    COMMENT_PROFILE,
    POST_PROFILE,
    SOLUTION_PROFILE,
    BLOCK_ID_RE,
    block_texts,
    plain,
)

MAX_QUOTE_CHARS = 500
MAX_CONTEXT_CHARS = 64

PART_ID_RE = re.compile(r'^part-[0-9]{1,10}$')


def _notebook_or_body(obj, profile) -> dict[str, str]:
    blocks = getattr(obj, 'blocks', None) or []
    if blocks:
        return block_texts(blocks, profile=profile)
    return {'body': getattr(obj, 'body', '') or ''}


def _exercise_blocks(exercise) -> dict[str, str]:
    """An exercise's statement and answer (every published translation — a quote may come from any
    language somebody is reading), plus one implicit block per part."""
    out = {'statement': '', 'answer': ''}
    for statement, answer in exercise.translations.filter(status='published').values_list('statement', 'answer'):
        out['statement'] += f'\n{statement}'
        out['answer'] += f'\n{answer}'
    for part_id in exercise.parts.values_list('pk', flat=True):
        out[f'part-{part_id}'] = ''
    return out


def _concept_article_blocks(article) -> dict[str, str]:
    """The PUBLISHED head's blocks: a comment is about the article a reader can see, not a draft."""
    from concepts.blocks import CONCEPT_PROFILE

    head = article.revisions.filter(status='published').order_by('-number').first()
    return block_texts(head.blocks if head else [], profile=CONCEPT_PROFILE)


#: `(app_label, model) → how to read that row's addressable blocks`. A target NOT listed here has no
#: blocks to point at, and an anchor on it is refused (`not_addressable`) rather than stored as a
#: claim nobody can check. Deliberately shorter than `targets.TARGET_TYPE_BY_MODEL`: a coverage
#: claim or a course has no text a reader would quote.
ADDRESSABLE = {
    ('community', 'comment'): lambda obj: _notebook_or_body(obj, COMMENT_PROFILE),
    ('exercises', 'solutionentry'): lambda obj: _notebook_or_body(obj, SOLUTION_PROFILE),
    ('activity', 'post'): lambda obj: _notebook_or_body(obj, POST_PROFILE),
    ('exercises', 'exercise'): _exercise_blocks,
    ('concepts', 'conceptarticle'): _concept_article_blocks,
    ('community', 'review'): lambda obj: {'body': obj.body or ''},
    ('issues', 'issue'): lambda obj: {'body': obj.body or ''},
}


def addressable_blocks(obj) -> dict[str, str] | None:
    """`{block id: plain text}` for `obj`, or None when this kind of thing has no blocks."""
    if obj is None:
        return None
    reader = ADDRESSABLE.get((obj._meta.app_label, obj._meta.model_name))
    return reader(obj) if reader is not None else None


def _well_formed_block_id(value: str) -> bool:
    return bool(BLOCK_ID_RE.match(value) or PART_ID_RE.match(value))


def clean_anchor(raw, *, target, parent) -> dict:
    """The anchor to store (`{}` for none), or a DRF `ValidationError` with an `anchor` key whose
    message is a WORD the frontend has a sentence for (house rule 6)."""
    if raw in (None, '', {}):
        return {}
    if not isinstance(raw, dict):
        raise serializers.ValidationError({'anchor': ['malformed']})
    block = str(raw.get('block') or '')
    if not _well_formed_block_id(block):
        raise serializers.ValidationError({'anchor': ['malformed']})
    subject = parent if parent is not None else target
    blocks = addressable_blocks(subject)
    if blocks is None:
        raise serializers.ValidationError({'anchor': ['not_addressable']})
    if block not in blocks:
        raise serializers.ValidationError({'anchor': ['no_such_block']})
    quote = plain(raw.get('quote'), MAX_QUOTE_CHARS + 1)
    if len(quote) > MAX_QUOTE_CHARS:
        raise serializers.ValidationError({'anchor': ['quote_too_long']})
    out = {'block': block}
    if quote:
        # Context is kept only beside a quote: without one there is nothing to disambiguate. NOT
        # stripped, because the space between the context and the quote is part of what matches.
        out['quote'] = quote
        out['prefix'] = plain_context(raw.get('prefix'), keep='end')
        out['suffix'] = plain_context(raw.get('suffix'), keep='start')
    return out


def plain_context(value, *, keep: str) -> str:
    """A few characters of context: tag-free, unstripped, cut from the END that touches the quote."""
    from config.blocks import _TAG_RE
    from config.sanitize import sanitize_content

    text = _TAG_RE.sub('', sanitize_content(str(value or '')))
    return text[-MAX_CONTEXT_CHARS:] if keep == 'end' else text[:MAX_CONTEXT_CHARS]


def reading(comment, *, cache: dict) -> dict | None:
    """The anchor as a reader gets it, with `state`; None for a comment about the whole thing.

    `cache` is shared across one serialized thread, so a thread of forty comments anchored to the
    same solution reads that solution's blocks once.
    """
    anchor = comment.anchor or {}
    if not anchor.get('block'):
        return None
    if comment.parent_id is not None:
        key = ('comment', comment.parent_id)
        if key not in cache:
            from .models import Comment

            parent = Comment.objects.filter(pk=comment.parent_id).first()
            hidden = parent is None or parent.is_removed or parent.auto_hidden_at is not None
            cache[key] = (addressable_blocks(parent) or {}, hidden)
    else:
        key = (comment.content_type_id, comment.object_id)
        if key not in cache:
            ct = ContentType.objects.get_for_id(comment.content_type_id)
            target = ct.model_class()._default_manager.filter(pk=comment.object_id).first()
            cache[key] = (addressable_blocks(target) or {}, False)
    blocks, subject_hidden = cache[key]
    out = {
        'block': anchor['block'],
        'quote': '' if subject_hidden else anchor.get('quote', ''),
        'prefix': '' if subject_hidden else anchor.get('prefix', ''),
        'suffix': '' if subject_hidden else anchor.get('suffix', ''),
        'state': 'attached' if anchor['block'] in blocks else 'detached',
    }
    return out


__all__ = ['ADDRESSABLE', 'MAX_QUOTE_CHARS', 'addressable_blocks', 'clean_anchor', 'reading']
