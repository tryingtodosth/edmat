"""A person's own content, all at once: what they wrote, the licence each piece carries, and the
one move that widens many of them (owner, 2026-10-22: "improve the way user can decide/edit their
contents' licence in bulk").

It adds NO authority (house boundary #2). Every item is decided by `rules.change_licence`, exactly
as the item page's control decides it — this module only finds the items and loops:

- `my_items(user)` — every POSTED item of the four kinds `user` is an author of
  (`targets.Kind.authors`, the set the rules ask), with what each could move to right now and,
  when nothing, why. Posted means what `relicense_content` means: what a reader could open today
  (`Kind.visible`). A draft or a removed item keeps its own page's control.
- `apply_bulk(user, to, items)` — each `(kind, id)` through `rules.change_licence` as `user`, one
  WHERE-anchored UPDATE per item and no transaction around the loop (backend/CLAUDE.md SQLite rule
  2: never a long multi-table atomic). Partial success is the honest result: one item refused
  because a co-author's version is in it does not undo the twenty that moved.

**A stranger's id leaks nothing.** An item that does not exist, is not posted, or is not the
caller's comes back with the SAME reason, `licence_not_found` — the bulk endpoint never says "that
exists but isn't yours", which the per-item endpoint may (a readable item, 403), because a list of
ids is a cheap way to probe for unpublished ones.

The words this module adds — `licence_not_found`, `licence_already_most_open`,
`licence_bulk_items_required`, `licence_bulk_item_invalid`, `licence_bulk_too_many` (and the
page's own `licence_bulk_throttled` for a 429) — each have a sentence in
`frontend/src/lib/utils/labels.ts: licenceReasonLabel`, a hand-kept mirror (house rule 13).
"""

from __future__ import annotations

from collections.abc import Iterable

from django.db.models import Q

from . import rules
from .licences import LICENCES
from .targets import LICENSED_KINDS, kind_for

#: Per kind, the most `my_items` returns (newest first); `truncated` says when there were more.
#: The largest real account (an importer's, ~620 exercises and ~1200 hints/solutions) fits.
MINE_LIMIT_PER_KIND = 2000

#: The most items one POST may name. The page sends a bigger selection in chunks of this size.
BULK_MAX_ITEMS = 500

#: The most open licence; an item already there has nothing to widen to.
_MOST_OPEN = 'cc0-1.0'


def _authored(kind_name: str, user):
    """The kind's rows `user` is an author of, as a queryset — the SAME people `Kind.authors`
    names (re-checked per item below, so a drift here could only hide an item, never add one)."""
    kind = kind_for(kind_name)
    model = kind.model
    if kind_name == 'exercise':
        return model.objects.filter(submitted_by=user).prefetch_related('translations')
    if kind_name == 'solution_entry':
        return model.objects.filter(author=user).select_related('exercise', 'part')
    if kind_name == 'material':
        from coauthoring.models import MaterialProject

        owned = MaterialProject.objects.filter(members__user=user, members__role='owner').values('material_id')
        return model.objects.filter(Q(submitted_by=user) | Q(pk__in=owned)).prefetch_related('translations')
    if kind_name == 'concept_article':
        return model.objects.filter(created_by=user).select_related('concept')
    raise ValueError(kind_name)


def _pick(rows, locale: str, fallback: str = ''):
    by_locale = {r.locale: r for r in rows}
    return by_locale.get(locale) or by_locale.get(fallback) or next(iter(by_locale.values()), None)


def _exercise_title(exercise, locale: str) -> str:
    published = [t for t in exercise.translations.all() if t.status == 'published']
    t = _pick(published, locale, exercise.original_locale)
    return t.title if t and t.title else f'#{exercise.number}'


def _describe(kind_name: str, obj, locale: str) -> dict:
    """What the page needs to name the item and link to it — never more than a reader of the item
    page would see."""
    if kind_name == 'exercise':
        return {'title': _exercise_title(obj, locale), 'exercise_id': str(obj.pk)}
    if kind_name == 'solution_entry':
        return {
            'title': _exercise_title(obj.exercise, locale),
            'entry_kind': obj.kind,
            'part_label': obj.part.label if obj.part_id else '',
            'exercise_id': str(obj.exercise_id),
        }
    if kind_name == 'material':
        t = _pick(list(obj.translations.all()), locale)
        return {'title': t.title if t else obj.slug, 'material_id': str(obj.pk)}
    # concept_article
    revision = obj.revisions.filter(status='published').order_by('-number').first()
    return {
        'title': revision.title if revision else obj.concept.slug,
        'concept_slug': obj.concept.slug,
        'audience': obj.audience,
        'locale': obj.locale,
    }


def _blocked_reason(obj, user) -> str:
    """Why an item of the caller's offers nothing: asked of the rules against the most open key,
    so it is the rules' own word (a co-author's work is in it), or 'already as open as it gets'."""
    reason = rules.change_block_reason(obj, _MOST_OPEN, user, check_note=False)
    if reason in (None, 'licence_unchanged'):
        return 'licence_already_most_open'
    return reason


def my_items(user, locale: str = 'pl') -> dict:
    out = {}
    for kind_name in LICENSED_KINDS:
        kind = kind_for(kind_name)
        qs = _authored(kind_name, user).order_by('-pk')
        rows = []
        truncated = False
        # Iterated, not sliced: the bound is on what is LISTED, and a draft or a removed item in
        # the queryset must not eat a place (nor hide that there were more).
        for obj in qs.iterator(chunk_size=500):
            if user.id not in kind.authors(obj) or not kind.visible(obj):
                continue
            if len(rows) == MINE_LIMIT_PER_KIND:
                truncated = True
                break
            allowed = rules.allowed_targets(obj, user)
            row = {
                'kind': kind_name,
                'id': str(obj.pk),
                'licence': obj.licence,
                'allowed': allowed,
                'blocked_reason': '' if allowed else _blocked_reason(obj, user),
            }
            row.update(_describe(kind_name, obj, locale))
            rows.append(row)
        out[kind_name] = {'items': rows, 'truncated': truncated}
    return {'kinds': out, 'limit_per_kind': MINE_LIMIT_PER_KIND, 'max_per_request': BULK_MAX_ITEMS}


class BulkRequestError(ValueError):
    """A malformed request (400) — the word says which part."""


def parse_items(raw) -> list[tuple[str, int]]:
    """`[{kind, id}, …]` → unique `(kind, pk)` pairs in the order given, or `BulkRequestError`."""
    if not isinstance(raw, list) or not raw:
        raise BulkRequestError('licence_bulk_items_required')
    if len(raw) > BULK_MAX_ITEMS:
        raise BulkRequestError('licence_bulk_too_many')
    seen: list[tuple[str, int]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise BulkRequestError('licence_bulk_item_invalid')
        kind_name = item.get('kind')
        if kind_name not in LICENSED_KINDS:
            raise BulkRequestError('licence_bulk_item_invalid')
        try:
            pk = int(str(item.get('id')))
        except (TypeError, ValueError):
            raise BulkRequestError('licence_bulk_item_invalid') from None
        if pk <= 0:
            raise BulkRequestError('licence_bulk_item_invalid')
        pair = (kind_name, pk)
        if pair not in seen:
            seen.append(pair)
    return seen


def apply_bulk(user, to: str, items: Iterable[tuple[str, int]]) -> dict:
    if to not in LICENCES:
        raise BulkRequestError('licence_unknown_key')
    results = []
    for kind_name, pk in items:
        kind = kind_for(kind_name)
        obj = kind.model.objects.filter(pk=pk).first()
        # One answer for "no such row", "not posted" and "not yours" — see the module docstring.
        if obj is None or user.id not in kind.authors(obj) or not kind.visible(obj):
            results.append({'kind': kind_name, 'id': str(pk), 'ok': False, 'reason': 'licence_not_found'})
            continue
        old = obj.licence
        reason = rules.change_licence(obj, to, user, '')
        if reason:
            results.append({'kind': kind_name, 'id': str(pk), 'ok': False, 'reason': reason, 'licence': old})
        else:
            results.append({'kind': kind_name, 'id': str(pk), 'ok': True, 'from': old, 'licence': obj.licence})
    changed = sum(1 for r in results if r['ok'])
    return {'to': to, 'results': results, 'changed': changed, 'refused': len(results) - changed}
