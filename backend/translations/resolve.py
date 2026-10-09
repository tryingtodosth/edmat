"""The one module that answers "which language does this reader get, and is a newer one waiting".

Every endpoint asks THIS — the root CLAUDE.md's second load-bearing boundary: a rule more than one
endpoint needs lives in one module. Four apps' serializers call `resolve()`; an endpoint that
re-implemented the fallback order is how two panels start disagreeing about which language a task
is in.

## The order, and why

1. **The reader's own interface language**, if somebody has written it. The owner's instruction:
   *"User sees the version in their UI language by default."*
2. **The original**, otherwise — the language it was written in, which is the honest second-best
   and is what the row's own column already says.
3. **Whatever exists**, if even the original row is missing (it should not be; handled rather
   than raised, the `config/i18n_utils.resolve_translation` precedent).
4. **The row's own columns**, when nothing has been written here at all — every management row
   from before this app existed. That is today's behaviour exactly, which is what makes the whole
   change additive.

## "How much newer"

The owner: *"if there's a newer version in a different language it says how much newer."* So this
compares the version the reader is being shown against the most recently written version in ANY
language, and reports the gap when the newest one is a different language. In seconds, because the
wording ("4 minutes", "2 days") is an interface string and belongs in the frontend's own
catalogue, not in a number the API invents a unit for.

It reads nothing when there is nothing to say: one language, or the reader is already on the newest
one, or the side-by-side editor wrote both in the same transaction — which is the whole point of
that editor existing (owner: *"so that … there's no sth like “newer in PL by 4 minutes”"*).
"""

from __future__ import annotations

from .targets import own_text

#: Matches `config.i18n_utils.DEFAULT_FALLBACK_LOCALE` and is imported from there rather than
#: restated, so the platform has one answer to "which language is the backstop".
from config.i18n_utils import DEFAULT_FALLBACK_LOCALE


def _versions(obj):
    """Every written version of this row, from the prefetched `GenericRelation` when the model has
    one (`.prefetch_related('text_versions')`) and from a query otherwise.

    The relation is what keeps this off the N+1 path: a serializer resolving fifty tasks does no
    queries at all once the view has prefetched, which is why the management models each carry a
    `GenericRelation` rather than this module querying per object.

    **The query fallback is not dead code.** It used to be `[]`, which silently meant "this row has
    no translations" for any model that had not declared the relation — and `contests.Contest`
    (2026-10-09) is the first registered kind that has not: a `GenericRelation` adds no column and so
    needs no migration, but it is a line in `contests/models.py`, which step B of the contests cycle
    does not own (`CONTESTS-BRIEF.md` §4). Answering with the row's own columns for a contest
    somebody HAD translated would have been a silent wrong answer rather than a missing
    optimisation. One query per object is the honest cost, and it disappears the moment the relation
    is added.
    """
    related = getattr(obj, 'text_versions', None)
    if related is not None:
        return list(related.all())
    from .models import TextVersion
    from .targets import content_type_for, kind_of

    kind = kind_of(obj)
    content_type = content_type_for(kind) if kind else None
    if content_type is None:
        return []
    return list(TextVersion.objects.filter(content_type=content_type, object_id=obj.pk))


def resolve(obj, locale: str | None) -> dict:
    """What the reader gets, and what else exists, for one management row.

    A thin wrapper: everything that is a JUDGEMENT lives in `pick` below, which takes plain values.
    The split is the `provenance.rules._derive` shape and exists for the same reason — the order
    and the staleness arithmetic are what would fail silently, and they are testable as a table
    only if they do not need a model, a registry entry and a database row to be exercised.
    """
    own_heading, own_body = own_text(obj)
    return pick(_versions(obj), own_heading, own_body, locale)


def pick(versions, own_heading: str, own_body: str, locale: str | None) -> dict:
    """The rule itself, over plain values. See this module's docstring for the order."""
    wanted = locale or DEFAULT_FALLBACK_LOCALE
    versions = list(versions)
    heading, body = own_heading, own_body

    if not versions:
        # Nothing has been written here: the row's own columns, shown to everybody, and no
        # staleness to report because there is only one text. Pre-existing rows land here.
        return {
            'heading': heading,
            'body': body,
            'locale': '',
            'requested_locale': wanted,
            'is_fallback': False,
            'available': [],
            'original_locale': '',
            'newer_elsewhere': None,
        }

    by_locale = {version.locale: version for version in versions}
    original = next((version for version in versions if version.is_original), None)
    chosen = by_locale.get(wanted) or original or versions[0]
    newest = max(versions, key=lambda version: version.updated_at)

    newer_elsewhere = None
    if newest.locale != chosen.locale and newest.updated_at > chosen.updated_at:
        newer_elsewhere = {
            'locale': newest.locale,
            'seconds': int((newest.updated_at - chosen.updated_at).total_seconds()),
        }

    return {
        'heading': chosen.heading,
        'body': chosen.body,
        'locale': chosen.locale,
        'requested_locale': wanted,
        # "We could not give you your own language" — the frontend says so rather than pretending
        # the Polish it just handed an English reader is the English.
        'is_fallback': chosen.locale != wanted,
        'available': sorted(by_locale),
        'original_locale': original.locale if original else '',
        'newer_elsewhere': newer_elsewhere,
    }


def resolved_heading(obj, locale: str | None) -> str:
    return resolve(obj, locale)['heading']


def resolved_body(obj, locale: str | None) -> str:
    return resolve(obj, locale)['body']


def versions_payload(obj) -> list[dict]:
    """Every version, for the side-by-side editor to fill both of its columns from. Ordered with
    the original first, because that is the column the editor draws on the left."""
    rows = sorted(_versions(obj), key=lambda version: (not version.is_original, version.locale))
    return [
        {
            'locale': version.locale,
            'is_original': version.is_original,
            'heading': version.heading,
            'body': version.body,
            'updated_at': version.updated_at,
        }
        for version in rows
    ]
