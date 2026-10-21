"""The one module that turns author marks and votes into a reading, and the one that says who may
write each of them. Every endpoint asks THIS — the owner's task names the requirement directly:
*"the formula in one rule module every endpoint asks — API, lists, the content page"*, which is
the root CLAUDE.md's second load-bearing boundary said in the owner's own words.

**The reading is two marks and one number** (the owner's decision of 2026-10-07, kept verbatim
here because the shape of the badge is the shape of this function's return value):

- `author_marked` — the single-person icon: *the author said a machine helped*.
- `community_marked` — the three-people icon: *enough readers, confident enough, think so*.
- `score` — one percent for a filter and a sort to use.

Each mark lights on its own, so the chip says WHO is claiming it. They are deliberately not folded
into one tri-state: "the author told us" and "readers suspect" are different claims with different
standing, and a reader deciding whether to trust a solution wants to know which one they are
looking at.

**Recounted, never incremented** (house rule 5), and the owner's task asks for it by name. Both
numbers below are aggregates over an indexed FK, computed per request; nothing anywhere keeps a
running total that one missed code path could leave wrong forever.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from django.db.models import Avg, Count

from .models import AssistanceVote, AuthorMark, ScoreLock
from .targets import PROVENANCE_KIND_MODELS, author_of, kind_of, model_for

#: How many people have to have voted before the three-people icon lights at all.
#:
#: The same safety rail, for the same reason, as `moderation/services.py`'s
#: MIN_REPORTS_FOR_AUTO_HIDE: a mean over one vote is one person's opinion wearing the word
#: "community", and one bad-faith vote should not be able to put a badge on somebody's work. The
#: exact number is one of the three things the owner's task left open ("the vote weight and
#: threshold"), and the organisation's poll is where it gets decided — so it lives here as a
#: named constant with its reasoning rather than inline in a comparison.
MIN_VOTES_FOR_COMMUNITY_MARK = 3

#: The mean confidence, in percent, at which the three-people icon lights.
COMMUNITY_MARK_THRESHOLD = 50


# ---- the reading ------------------------------------------------------------------------------


def _blank(kind: str, obj_id) -> dict:
    return {
        'kind': kind,
        'id': str(obj_id),
        'score': 0,
        'author_marked': False,
        'author_answered': False,
        'author_note': '',
        'community_marked': False,
        'votes': 0,
        'average_confidence': 0,
        'locked': False,
        'lock_value': None,
        'lock_reason': '',
        'my_confidence': None,
        'can_vote': False,
        'can_declare': False,
        'can_lock': False,
    }


def _derive(row: dict) -> dict:
    """The formula itself, over one already-gathered row. Separated from the gathering so that the
    rule can be read — and tested — without a database."""
    votes = row['votes']
    mean = row['average_confidence']

    if row['locked']:
        # A moderator has ended the argument. The lock replaces the community reading and the
        # score; it never touches `author_marked`, which is a record of what a person said about
        # their own work (see ScoreLock's own docstring).
        row['score'] = row['lock_value']
        row['community_marked'] = row['lock_value'] >= COMMUNITY_MARK_THRESHOLD
        return row

    row['community_marked'] = (
        votes >= MIN_VOTES_FOR_COMMUNITY_MARK and mean >= COMMUNITY_MARK_THRESHOLD
    )
    # "The author's mark is final; votes can only add the badge, never remove it" — the owner's
    # own proposal, 2026-10-07. So an author who has owned up reads 100 whatever the votes say,
    # and an author who has said "no machine helped" does NOT pull the score back down: their
    # answer is recorded and visible, and a reader weighs the two marks themselves. An author's
    # denial that silently erased every reader's reading would make the whole signal worthless on
    # exactly the content it matters most on.
    row['score'] = 100 if row['author_marked'] else mean
    return row


def summaries_for(pairs, user) -> dict:
    """`{"<kind>:<id>": reading}` for every (kind, id) in `pairs` that exists and is readable.

    Bounded by construction: four queries per KIND, never one per row, however many rows a page
    drew — which is the whole reason this is a batch endpoint and not a field on four serializers
    in three apps. A page asks once for everything it has just drawn, the way
    `providePageDiscussions` already does for a standing page's threads.

    Silently omits what it cannot show rather than erroring on it: a batch is a set of independent
    questions, and one id that has since been removed should cost that one chip, not the page.
    Omitting is also the honest answer for something this reader may not see — house rule 4, for
    them it does not exist.
    """
    by_kind: dict[str, set] = {}
    for kind, obj_id in pairs:
        if kind not in PROVENANCE_KIND_MODELS:
            continue
        try:
            by_kind.setdefault(kind, set()).add(int(obj_id))
        except (TypeError, ValueError):
            continue

    out: dict[str, dict] = {}
    for kind, ids in by_kind.items():
        model = model_for(kind)
        ct = ContentType.objects.get_for_model(model)
        objects = {obj.pk: obj for obj in model.objects.filter(pk__in=ids)}
        readable = {pk: obj for pk, obj in objects.items() if is_readable(obj, user)}
        if not readable:
            continue
        live = list(readable)

        rows = {pk: _blank(kind, pk) for pk in live}

        tally = (
            AssistanceVote.objects.filter(content_type=ct, object_id__in=live)
            .values('object_id')
            .annotate(n=Count('id'), mean=Avg('confidence'))
        )
        for entry in tally:
            row = rows.get(entry['object_id'])
            if row is None:
                continue
            row['votes'] = entry['n']
            row['average_confidence'] = int(round(entry['mean'] or 0))

        for mark in AuthorMark.objects.filter(content_type=ct, object_id__in=live):
            row = rows.get(mark.object_id)
            if row is None:
                continue
            row['author_answered'] = True
            row['author_marked'] = mark.assisted
            row['author_note'] = mark.note

        for lock in ScoreLock.objects.filter(content_type=ct, object_id__in=live):
            row = rows.get(lock.object_id)
            if row is None:
                continue
            row['locked'] = True
            row['lock_value'] = lock.value
            row['lock_reason'] = lock.reason

        if user is not None and getattr(user, 'is_authenticated', False):
            mine = AssistanceVote.objects.filter(
                content_type=ct, object_id__in=live, voter=user
            ).values_list('object_id', 'confidence')
            for obj_id, confidence in mine:
                row = rows.get(obj_id)
                if row is not None:
                    row['my_confidence'] = confidence

        for pk, row in rows.items():
            obj = readable[pk]
            row['can_vote'] = can_vote(user, obj)
            row['can_declare'] = can_declare(user, obj)
            row['can_lock'] = can_lock(user, obj)
            out[f'{kind}:{pk}'] = _derive(row)

    return out


def summary_for(obj, user) -> dict:
    """The reading for one already-fetched object — what a write endpoint answers with, so that a
    client never has to re-ask after voting."""
    kind = kind_of(obj)
    if not kind:
        return _blank('', getattr(obj, 'pk', 0))
    return summaries_for([(kind, obj.pk)], user).get(f'{kind}:{obj.pk}', _blank(kind, obj.pk))


# ---- who may say what -------------------------------------------------------------------------


def is_readable(obj, user) -> bool:
    """Whether this reader may see the content at all — the visibility half of house rule 4,
    applied before anything is said about it.

    Per model rather than generically, because the four targets hide themselves in three different
    ways; a staff member sees everything, which is the same bypass `feature_gate` already makes.
    """
    if user is not None and getattr(user, 'is_authenticated', False) and user.is_staff:
        return True
    if kind_of(obj) == 'concept_article':
        # An article is hidden by having no published revision as well as by removal, which none of
        # the generic attributes below can see — so the concepts app's own object-level check is
        # asked (house rule 4: its twin `visible_articles` is what every concept list filters by).
        from concepts.access import can_view_article

        return can_view_article(obj, user)
    # Which branch applies to which model, checked rather than assumed (2026-10-08):
    #   `is_removed`     — SolutionEntry, Comment, Review (an Exercise has none)
    #   `auto_hidden_at` — all four
    #   `published`      — Exercise alone
    #   `status`         — SolutionEntry alone
    # So the two model-specific branches below cannot fire on the wrong row, and a future target
    # with a `status` of its own would have to be read here before it is added to the registry.
    if getattr(obj, 'is_removed', False):
        return False
    if getattr(obj, 'auto_hidden_at', None) is not None:
        return False
    if getattr(obj, 'published', True) is False:
        return False
    status = getattr(obj, 'status', None)
    if status is not None and status != 'published':
        # The author of a pending entry sees their own, which is what the entry list already does.
        author = author_of(obj)
        return bool(author is not None and user is not None and author.pk == getattr(user, 'pk', None))
    return True


def can_declare(user, obj) -> bool:
    """Make (or change) the AUTHOR's mark: the person who wrote it, and global staff.

    Staff are included for one ordinary reason — a moderator acting on a report of "looks AI-made,
    not marked" needs somewhere to record the outcome, and `ScoreLock` is for ending an argument
    about the community's reading rather than for answering on the author's behalf. The row records
    `declared_by`, so a staff answer never reads as the author's own.
    """
    if not (user is not None and getattr(user, 'is_authenticated', False)):
        return False
    if user.is_staff:
        return True
    author = author_of(obj)
    return author is not None and author.pk == user.pk


def can_vote(user, obj) -> bool:
    """Vote on somebody else's content. Minors may — the owner's spec says so in as many words,
    and a vote carries no free text for them to be held over.

    The author may not vote on their own work, and that is not a tidiness rule: the author already
    has a channel that says exactly what they mean (`AuthorMark`), and letting them also move the
    community's number would let one person speak twice in two voices about the same thing.
    """
    if not (user is not None and getattr(user, 'is_authenticated', False)):
        return False
    author = author_of(obj)
    return not (author is not None and author.pk == user.pk)


def can_lock(user, obj) -> bool:
    """Freeze the community reading. Global staff, or a node governor over the branch the content
    belongs to — the same two-route authority `ReportActionView` already applies to this same set
    of content kinds, asked through the same helper so the two surfaces cannot drift apart."""
    if not (user is not None and getattr(user, 'is_authenticated', False)):
        return False
    if user.is_staff:
        return True
    from moderation.services import is_governor_of_course

    return is_governor_of_course(user, branch_of(obj))


def branch_of(obj):
    """The taxonomy branch a target sits under, for the governor check — or None, which
    `is_governor_of_course` already treats as a safe-default deny for a non-staff user."""
    kind = kind_of(obj)
    if kind == 'exercise':
        return getattr(obj, 'branch', None)
    if kind == 'solution_entry':
        exercise = getattr(obj, 'exercise', None)
        return getattr(exercise, 'branch', None)
    if kind == 'review':
        exercise = getattr(obj, 'exercise', None)
        return getattr(exercise, 'branch', None)
    if kind == 'comment':
        target = getattr(obj, 'target', None)
        from exercises.models import Exercise, SolutionEntry

        if isinstance(target, Exercise):
            return target.branch
        if isinstance(target, SolutionEntry):
            return target.exercise.branch
    return None
