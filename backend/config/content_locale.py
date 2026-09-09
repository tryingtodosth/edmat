"""The content-language rule (AUDIENCE-BRIEF.md §5): a LIST shows only items that have a published
version in the languages the reader asked for — by default the interface language alone — and
says how many it left out. A DETAIL page never filters: a shared link must not 404 because the
reader's interface happens to be in another language; it resolves and falls back as before.

`?content_locales=pl,en` is sent by the frontend on every browse request (the same client hook
that sends `?audience=`). Absent → no narrowing, so direct API consumers see everything, as they
always did. The hidden count rides back in the `X-EdMat-Hidden-Languages` response header, since
these lists are plain arrays with no envelope to put it in.
"""

HIDDEN_HEADER = 'X-EdMat-Hidden-Languages'


def parse_content_locales(raw) -> list[str] | None:
    if not raw:
        return None
    wanted = [part.strip().lower() for part in raw.split(',') if part.strip()]
    return wanted or None


def apply_content_locale_filter(qs, params, lookup: str, *, published_only: bool = False):
    """Narrow `qs` to rows whose `lookup` (a language column, or a translation's locale through a
    relation) is one of the requested locales. Returns `(qs, hidden_count)`; hidden is 0 when no
    narrowing was asked for. `published_only` adds `status='published'` on a translation
    relation, so a pending translation does not make an item appear in that language."""
    wanted = parse_content_locales(params.get('content_locales'))
    if wanted is None:
        return qs, 0
    before = qs.count()
    kwargs = {f'{lookup}__in': wanted}
    if published_only:
        relation = lookup.rsplit('__', 1)[0]
        kwargs[f'{relation}__status'] = 'published'
    narrowed = qs.filter(**kwargs).distinct()
    return narrowed, max(0, before - narrowed.count())
