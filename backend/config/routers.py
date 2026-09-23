"""The project's one DRF router: a numeric detail segment by default.

Why this exists. DRF's `SimpleRouter` builds a detail URL out of `lookup_value_regex`, which
defaults to `[^/.]+` — "anything that is not a slash or a dot". So `/api/events/undefined/`
matched the detail route, `get_object()` ran `pk='undefined'`, and Django's own integer field
raised on the cast (`ValueError: Field 'id' expected a number but got 'undefined'`): a **500** for
a request that is simply about nothing. A frontend that sends `undefined` in a URL is
a frontend bug, but the honest answer to "the thing at this id" when the id cannot name a thing is
404, not "the server fell over" — and a 500 is also what hides the frontend bug, because nothing
in a log tells the two apart.

Rather than write `lookup_value_regex = '[0-9]+'` on forty viewsets (and forget it on the
forty-first, which is exactly how this class of bug comes back), the default lives in the router,
which is the one place that already knows how a detail URL is spelled.

**Two opt-outs, both automatic**, because a numeric default must not break the ids that are not
numbers:

1. A viewset that sets its own `lookup_value_regex` keeps it — `concepts.ConceptViewSet`
   (`[-a-zA-Z0-9_]+`) is the standing example.
2. A viewset whose `lookup_field` is not `pk` is left alone: `taxonomy.Discipline` and
   `taxonomy.Branch` are addressed by slug (root `CLAUDE.md`, "Ids"), `study.ExerciseSetViewSet`
   and `exercises.TagViewSet` by slug, `moderation.FeatureFlagViewSet` by key. Forcing digits on
   any of those would 404 every real URL they have.

**Nested ids inside a custom `@action`'s `url_path` are NOT reached by this** — they are that
action's own regex, and the router never sees them. They had exactly the same bug, and worse,
because `.filter(pk='undefined')` on an already-scoped related manager raises the same `ValueError`
that `get_object()` did: `/api/events/50/staff/undefined/` was a 500 too. The eleven in `events/`
now interpolate `NUMERIC_PK_REGEX` below, and `events/test_permission_matrix.py` has a row for
each. **Every other app's nested actions still carry DRF's `[^/.]+`** — a new step adding one
should interpolate this constant, and the remaining apps are named as left open in `HISTORY.md`
§17BF.B.

Found beside the role-preview work (CONFERENCE-BRIEF.md §3.B) — the permission matrix asks for
`/api/<thing>/undefined/` on purpose, and every row of it expects 404.
"""

from rest_framework.routers import DefaultRouter

#: What a pk-addressed detail segment may contain. Deliberately not `\d+` — Python's `\d` is
#: Unicode-aware, so it also matches e.g. Devanagari digits, which `int()` accepts and no primary
#: key in this database has ever been.
NUMERIC_PK_REGEX = '[0-9]+'


class NumericPkRouter(DefaultRouter):
    """`DefaultRouter`, with `[0-9]+` as the detail segment for pk-addressed viewsets.

    Every app's `urls.py` builds its router from this class rather than `DefaultRouter`. That is
    the whole change: no viewset needs to know about it, and a new viewset gets the behaviour by
    being registered.
    """

    def get_lookup_regex(self, viewset, lookup_prefix=''):
        explicit = getattr(viewset, 'lookup_value_regex', None)
        lookup_field = getattr(viewset, 'lookup_field', 'pk')
        if explicit is not None or lookup_field != 'pk':
            return super().get_lookup_regex(viewset, lookup_prefix)
        # `lookup_url_kwarg` is read the way DRF's own implementation reads it, so a viewset that
        # renames its URL keyword keeps that name — only the VALUE pattern is narrowed here.
        lookup_url_kwarg = getattr(viewset, 'lookup_url_kwarg', None) or lookup_field
        return f'(?P<{lookup_prefix}{lookup_url_kwarg}>{NUMERIC_PK_REGEX})'
