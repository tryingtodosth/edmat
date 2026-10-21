"""Who may change a piece of content's licence, to what, and the one function that does it.

Every endpoint that changes a licence asks this module (house boundary #2); `views.py` is a thin
wrapper. The rules, each with the reason it returns (house rule 6):

1. Only the author (`targets.Kind.authors`) or staff may change it — `licence_not_author`.
2. A person picks from the selectable licences; `unknown` is staff-only, as a "rights in question"
   marker — `licence_not_selectable`.
3. **Only towards more open** (`licences.at_least_as_open`) — `licence_narrowing`. Creative Commons
   grants are irrevocable, so a narrower label would misdescribe every copy already taken. Leaving
   `unknown` or `edmat-only` is always a widening.
4. **Nobody relicenses somebody else's writing** — `licence_other_contributors` when a co-author of
   a material or a reviser of a concept article is not the person asking. Staff included: staff
   authority clears a rights question, it does not grant a licence on a stranger's sentences.
   Staff moving content OUT of `unknown` (rights cleared with the holder) is the one exception.
5. A staff member acting without being the author says why — `licence_note_required`.
6. The change itself is one WHERE-anchored `UPDATE … WHERE licence = <old>`; a lost race is
   `licence_conflict` (409 — the world moved), never a silent overwrite.
"""

from __future__ import annotations

from django.db.models import Max

from .licences import LICENCES, UNKNOWN, at_least_as_open, is_selectable
from .models import LicenceChange
from .targets import content_type_of, kind_for, kind_name_of

#: Reasons that mean "the world moved" rather than "the request was wrong" — the view answers 409.
CONFLICT_REASONS = frozenset({'licence_conflict'})


def _is_staff(user) -> bool:
    return bool(user is not None and getattr(user, 'is_authenticated', False) and user.is_staff)


def can_manage(obj, user) -> bool:
    """Whether `user` may change this item's licence at all (to something)."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return False
    kind = kind_for(kind_name_of(obj))
    return bool(kind) and (user.is_staff or user.id in kind.authors(obj))


def change_block_reason(obj, new: str, user, note: str = '', *, check_note: bool = True) -> str | None:
    if user is None or not getattr(user, 'is_authenticated', False):
        return 'licence_not_signed_in'
    kind = kind_for(kind_name_of(obj))
    if kind is None:
        return 'licence_unknown_kind'
    is_author = user.id in kind.authors(obj)
    staff = bool(user.is_staff)
    if not (is_author or staff):
        return 'licence_not_author'
    if new not in LICENCES:
        return 'licence_unknown_key'
    old = obj.licence
    if new == old:
        return 'licence_unchanged'
    if new == UNKNOWN:
        if not staff:
            return 'licence_not_selectable'
    elif not is_selectable(new):
        return 'licence_not_selectable'
    leaving_unknown_as_staff = old == UNKNOWN and staff
    if new != UNKNOWN and not at_least_as_open(new, old):
        return 'licence_narrowing'
    if new != UNKNOWN and not leaving_unknown_as_staff:
        others = kind.contributors(obj) - {user.id}
        if others:
            return 'licence_other_contributors'
    if check_note and staff and not is_author and not (note or '').strip():
        return 'licence_note_required'
    return None


def allowed_targets(obj, user) -> list[str]:
    """Every licence `user` could move this item to right now (ignoring the note a staff member
    would still have to write) — what the frontend's "change licence" control offers."""
    if not can_manage(obj, user):
        return []
    return [
        key
        for key in LICENCES
        if change_block_reason(obj, key, user, check_note=False) is None
    ]


def change_licence(obj, new: str, user, note: str = '') -> str | None:
    """Change `obj.licence` to `new`, record it, and return None — or return the refusal reason and
    change nothing."""
    reason = change_block_reason(obj, new, user, note)
    if reason:
        return reason
    old = obj.licence
    model = type(obj)
    if model.objects.filter(pk=obj.pk, licence=old).update(licence=new) != 1:
        return 'licence_conflict'
    kind = kind_for(kind_name_of(obj))
    LicenceChange.objects.create(
        content_type=content_type_of(obj),
        object_id=obj.pk,
        from_licence=old,
        to_licence=new,
        changed_by=user,
        as_staff=bool(user.is_staff and user.id not in kind.authors(obj)),
        note=(note or '').strip()[:500],
    )
    obj.licence = new
    _carry_to_own_text(obj, old, new)
    return None


def _carry_to_own_text(obj, old: str, new: str) -> None:
    """An exercise's text in its ORIGINAL language, and any translation its own author wrote, are
    the author's work and move with the exercise. A translation somebody else wrote keeps the
    licence it was contributed under (`ExerciseTranslation.licence`) — relicensing it is that
    translator's decision, not this author's.

    The PARTS of a set-shaped exercise (`exercises.ExercisePart` and its translation rows,
    2026-10-21) have no licence column, by design: a part is the exercise's own text, so it is
    covered by `Exercise.licence` and moves the moment that does — nothing to carry. A part's text
    in another language written through an edit suggestion is a contribution INTO the exercise
    under the licence it showed (the Wikipedia shape `MaterialVersion` has), not a separate work.
    `licensing/test_parts.py` pins that a change and the bulk command run over an exercise with
    parts. A translation FORM for parts (left open) would be the day a part translation by
    somebody else needs `ExerciseTranslation`'s stamped licence — not before."""
    if kind_name_of(obj) != 'exercise':
        return
    from django.db.models import Q

    from exercises.models import ExerciseTranslation

    own = Q(locale=obj.original_locale)
    if obj.submitted_by_id is not None:
        own |= Q(translated_by_id=obj.submitted_by_id)
    ExerciseTranslation.objects.filter(exercise=obj, licence=old).filter(own).update(licence=new)


def licence_since(obj):
    """When the current licence took effect: the newest recorded change, else creation."""
    latest = LicenceChange.objects.filter(
        content_type=content_type_of(obj), object_id=obj.pk
    ).aggregate(at=Max('changed_at'))['at']
    if latest is not None:
        return latest
    kind = kind_for(kind_name_of(obj))
    return kind.created_at(obj) if kind else None


def history(obj):
    return LicenceChange.objects.filter(content_type=content_type_of(obj), object_id=obj.pk)
