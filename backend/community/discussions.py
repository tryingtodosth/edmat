"""Who may talk under a section of a standing page, and where that question is answered.

The `/about` landing page, the seven `/about/<feature>` showcase pages and the manual's twelve
pages are **prerendered prose** (`frontend/svelte.config.js`'s prerender list). They have no row in
any table, so a `Comment` — which reaches its target through a `GenericForeignKey` — had nothing to
point at. `DiscussionLocation` is that row: one per place on one of those pages where a thread may
be opened, created the first time somebody writes there, and the thing a moderator switches off.

This module is the ONE place the "may this person post here?" question is answered (root
`CLAUDE.md` boundary 2). Three callers ask it — the read endpoint, so an anonymous reader is shown
the right invitation rather than a form that will refuse them; the write endpoint, before anything
is saved; and the moderation list, which shows a moderator what each location currently allows. An
endpoint that re-implemented it is how two surfaces start disagreeing.

## The two settings are deliberately separate

The owner asked for five options in one breath — "anyone (anons as well), users, verified users,
staff, and pending" — and they are not five values of one thing. Four of them answer *who*, and
`pending` answers *what happens to what they wrote*. As one field, "verified contributors, and hold
what they write" is not expressible; as two, it is. So:

    audience   anyone | users | verified | staff      who may write at all
    moderated  bool                                   whether what they write waits for a moderator

## Anonymous writing is always held, whatever `moderated` says

`audience='anyone'` includes people with no account, and that is the one case where the two fields
do not combine freely: an anonymous comment is held for approval even on an unmoderated location.
Every other moderation surface on this site has an account behind the row — somebody to notify, to
suspend, to show a history of (`moderation/services.py`), and `Comment`'s own tombstone distinguishes
"the author deleted this" from "a moderator removed it". None of that exists for a visitor, so the
only honest place to put an anonymous comment is in front of a human before anybody else reads it.
That is `held_at`, and `post_block_reason` never refuses for it — being held is not a refusal, and
the writer is told so (house rule 6 and house rule 10: flag it, don't fake it).

## The page allowlist is a pattern, not a list

A section key is `<page>#<section>`, and `page` must match `about` or `about/<seg>` or
`about/<seg>/<seg>`. A hand-maintained list of every legal key would be the drift this project has
been bitten by before (`labels.ts`, the flag enum): the manual's chapters are one dynamic route and
its sections live in `frontend/src/lib/content/guide/*.ts`, which Python cannot read. So the shape
is validated here and the frontend declares what it draws, the same division `community/targets.py`
settles for comment target names. What it costs is named in `todo.md`: a junk-but-well-formed key
creates a location row nobody will ever read, visible to moderators as a row with no comments.

## Refusal words

`post_block_reason` returns one word, the vocabulary the other rule modules use (house rule 6):

    off                 the `about_discussions` flag is off, or this location is switched off
    anonymous           this location wants an account and there is none
    verification_required  wants a verified contributor (`config/creation.py`'s own word)
    staff_only          wants staff
    minor               an under-16 may not write where anonymous strangers can read and reply

`minor` is the one rule here that no moderator can switch off, for the same reason
`config/creation.py` puts it ahead of the flag it answers to: it is GDPR Art. 8 as transposed in
Poland (`accounts/minors.py`), not a product setting. It applies only to `audience='anyone'` — a
minor may take part in a discussion among accounts, which is what every other thread on this site
already allows them.

## What "N comments" counts, and why a tombstone is not one

Three places print a number for a location, and they have to agree or the collapsed line promises
a thread that turns out to be shorter: `DiscussionPolicyView`'s `comment_count`,
`DiscussionLocationSerializer.get_comment_count`, and the collapsed line in
`SectionDiscussion.svelte`. All three count **public** comments — not removed, not held — and the
reason is that a reader counting for themselves would get the same number: a tombstone is a
placeholder where a comment used to be, not a comment, and a held comment has never been public at
all. The two server-side counts said this from the start; the third did not — it was
`thread.comments.length`, and the thread deliberately carries tombstones (so the tree keeps its
shape, house rule 12) and carries held rows for staff and for their own author, so "(3)" could be
one real comment, one tombstone and one thing waiting for a moderator. Fixed in the component,
2026-10-06, and written down here because the next person to add a count will look here first.

This is also what lets `e2e/about-discussions.mjs` assert an EXACT number rather than ">= 1": the
script's signed-in comments it deletes as their author (`DELETE /api/comments/{id}/`, a tombstone),
its anonymous one it removes through the report queue as staff — and neither a tombstone nor a held
row is counted, so the count comes back to exactly what it was before the run. That is why this
surface still has no delete endpoint of its own and still needs none (house rule 12; the
`DiscussionLocationViewSet` docstring refuses `destroy` for the ROW for a different reason again).

## A row is created by a write that SUCCEEDS

`DiscussionLocation` rows are lazy (the model's own docstring says why), and lazily means "when
somebody writes here", not "when somebody tries". A refused write (403), a malformed body (400) and
a reply naming a parent in another thread (400) all leave no row behind — otherwise a client could
manufacture a moderation-list row it is not even allowed to write at. The parent check is what made
this non-obvious: it needs the row to compare against, so the row used to be created before it. It
is not any more — an absent row simply means the named parent cannot belong here.

What is left over from before that rule, plus the well-formed junk keys the pattern allowlist
permits by design, is what `manage.py sweep_discussion_locations` removes: a row with no comments,
default settings and no `updated_by` is a row nobody decided anything about, so deleting it loses
no decision. See the command's own docstring.
"""

from __future__ import annotations

import hashlib
import re

from django.conf import settings

from accounts.minors import is_minor
from moderation.services import is_feature_enabled

#: The flag this whole surface answers to. Read with `is_feature_enabled` rather than through
#: `feature_gate`, because the read endpoint must keep answering for everybody when it is off — it
#: then says "no discussion here", which is what lets the frontend draw nothing at all rather than
#: an affordance that fails on click (house rule 3).
FEATURE_KEY = 'about_discussions'

#: `about`, `about/flashcards`, `about/guide`, `about/guide/courses` — and nothing with a third
#: segment, a capital, an underscore or a dot. Bounded on purpose: this is the whole reason a
#: well-formed junk key is the worst a stranger can produce here.
PAGE_RE = re.compile(r'^about(?:/[a-z0-9-]{1,40}){0,2}$')

#: A section anchor as the page's own markup spells it. `''` is legal and means the WHOLE page —
#: see `effective_policy`, where a page-level row acts as the ceiling over its sections.
SECTION_RE = re.compile(r'^[a-z0-9-]{1,60}$')

AUDIENCE_ANYONE = 'anyone'
AUDIENCE_USERS = 'users'
AUDIENCE_VERIFIED = 'verified'
AUDIENCE_STAFF = 'staff'

AUDIENCE_CHOICES = [
    (AUDIENCE_ANYONE, 'Anyone, including visitors who are not signed in'),
    (AUDIENCE_USERS, 'Any signed-in account'),
    (AUDIENCE_VERIFIED, 'Verified contributors and staff'),
    (AUDIENCE_STAFF, 'Staff only'),
]

#: What a location that nobody has configured allows. `users` rather than `anyone`, because a
#: default is a decision too and the wider one should be somebody's choice rather than the
#: consequence of never making one; `moderated=False`, because holding every comment on a page of
#: prose for approval would be a queue nobody asked for.
DEFAULT_AUDIENCE = AUDIENCE_USERS
DEFAULT_MODERATED = False


def parse_key(key: str) -> tuple[str, str]:
    """``'about/guide/courses#enrolling'`` -> ``('about/guide/courses', 'enrolling')``.

    Raises `ValueError` with a refusal word for anything malformed, so a view can answer 400 with
    a reason rather than a stack trace. A key with no `#` is the page itself.
    """
    raw = (key or '').strip()
    page, _, section = raw.partition('#')
    if not PAGE_RE.match(page):
        raise ValueError('page')
    if section and not SECTION_RE.match(section):
        raise ValueError('section')
    return page, section


def location_key(page: str, section: str) -> str:
    """The inverse of `parse_key`, so the one spelling of a key lives here too."""
    return f'{page}#{section}' if section else page


def report_location_key(target) -> str | None:
    """The location key for a reported comment's own target, or `None` if it is not one of ours.

    **`moderation/services.py` reads this** — it is the one thing the report queue knows about this
    app, and it is here rather than there so that the spelling of a key stays in the module that
    owns it (house rule 13: mirrored across two files, said in both). The queue's report rows carry
    the result as `discussion_location`, which is what lets `/moderation?tab=reports&location=<key>`
    show a moderator the held comments at ONE location — the number the panel prints next to that
    location, made clickable.

    Deliberately takes the already-resolved object rather than the comment: the queue builder has
    bulk-resolved every reported comment's direct target by the time it asks, and a function that
    took the comment would do that hop a second time, once per row.
    """
    from .models import DiscussionLocation

    if not isinstance(target, DiscussionLocation):
        return None
    return location_key(target.page, target.section)


def ip_hash(request) -> str:
    """A salted hash of the writer's address, for rate limiting an anonymous comment and nothing
    else.

    Salted with `SECRET_KEY` so the digests are useless to anybody who gets the database without
    it, and stored instead of the address itself because an IP is personal data under GDPR and this
    row has no retention story of its own (`LEGAL.md`). It is never shown, never compared across
    locations, and never used to decide whether a comment is visible — only to answer "has this
    address already written three times in the last minute".
    """
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    addr = forwarded.split(',')[0].strip() if forwarded else request.META.get('REMOTE_ADDR', '')
    if not addr:
        return ''
    return hashlib.sha256(f'{settings.SECRET_KEY}:{addr}'.encode()).hexdigest()


def _is_verified(user) -> bool:
    return bool(getattr(getattr(user, 'profile', None), 'is_verified_contributor', False))


def effective_policy(page: str, section: str) -> dict:
    """What this exact location currently allows, page-level row included.

    A row with `section=''` is the page's own setting and acts as a **ceiling** over every section
    on it: switching the page off switches off each of its sections, and narrowing the page to
    `staff` narrows them too, without a moderator having to find and edit every one. That is what
    makes a per-section switch usable at all — the manual's twelve pages have dozens of sections
    between them, and "turn discussion off on this chapter" has to be one action.

    Narrowing, not overriding: where the page and the section disagree, the **narrower** of the two
    wins. A page set to `anyone` with one section set to `staff` leaves that section staff-only; a
    page set to `staff` with a section left at the default does not widen that section back out.
    `moderated` is an OR for the same reason — if either says "hold it", it is held.
    """
    from .models import DiscussionLocation

    rows = {
        row.section: row
        for row in DiscussionLocation.objects.filter(page=page, section__in=['', section])
    }
    page_row = rows.get('')
    section_row = rows.get(section) if section else None

    present = [row for row in (page_row, section_row) if row is not None]

    enabled = is_feature_enabled(FEATURE_KEY) and all(row.is_enabled for row in present)
    # The default is what applies when NOBODY has decided — it is not a floor the rows then narrow
    # from. Folding it into the same `_narrower` chain as the rows was the first version of this
    # function and it was wrong in the one direction that matters: with `DEFAULT_AUDIENCE = 'users'`
    # a location explicitly set to `anyone` came back as `users`, so the widest setting a moderator
    # can choose was the one setting that did nothing. Every refusal test for an anonymous writer
    # passed anyway, because the refusal it expected was the one the bug produced.
    audience = DEFAULT_AUDIENCE
    if present:
        audience = _known(present[0].audience)
        for row in present[1:]:
            audience = _narrower(audience, row.audience)
    moderated = any(row.moderated for row in present) if present else DEFAULT_MODERATED
    return {
        'key': location_key(page, section),
        'page': page,
        'section': section,
        'is_enabled': enabled,
        'audience': audience,
        'moderated': moderated,
    }


#: Widest first. `_narrower` is an index comparison over this, so the order IS the rule.
_AUDIENCE_ORDER = [AUDIENCE_ANYONE, AUDIENCE_USERS, AUDIENCE_VERIFIED, AUDIENCE_STAFF]


def _narrowness(audience: str) -> int:
    """How narrow an audience value is, as an index into `_AUDIENCE_ORDER`.

    A value this build does not know — a row written by a newer deploy, or by hand in the admin —
    scores as narrower than anything it knows, so it fails CLOSED rather than being ignored.
    """
    try:
        return _AUDIENCE_ORDER.index(audience)
    except ValueError:
        return len(_AUDIENCE_ORDER)


def _known(audience: str) -> str:
    """An audience value this build recognises, or the narrowest one if it does not.

    Every path out of a stored row goes through here, a SINGLE row's included: the first version
    only normalised when two rows had to be compared, so one row set to an unknown value came back
    verbatim and `post_block_reason` then matched none of its branches and refused nobody. Failing
    closed has to be the behaviour of the common path, not of the comparison.
    """
    return audience if audience in _AUDIENCE_ORDER else AUDIENCE_STAFF


def _narrower(a: str, b: str) -> str:
    return max(_known(a), _known(b), key=_narrowness)


def post_block_reason(user, policy: dict) -> str | None:
    """`None` means go ahead. Otherwise one word — see the module docstring.

    Ordered like `config/creation.py`'s gate and for the same reasons: the flag first (nothing else
    matters when the surface is off), then staff, then the rule no moderator can lift, then the
    audience test. Being HELD for approval is not a refusal and never appears here; `held_for` is
    the separate question.
    """
    if not policy['is_enabled']:
        return 'off'

    authenticated = bool(user is not None and getattr(user, 'is_authenticated', False))
    if authenticated and user.is_staff:
        # Matching `feature_gate`'s own bypass: a moderator has to be able to write where the
        # setting they are testing applies, in order to see what it does to everybody else.
        return None

    audience = policy['audience']
    if audience == AUDIENCE_STAFF:
        return 'staff_only'
    if not authenticated:
        return None if audience == AUDIENCE_ANYONE else 'anonymous'

    if audience == AUDIENCE_ANYONE and is_minor(user):
        # Only here, and only for `anyone`: this is the one location kind where a stranger with no
        # account can read and reply to what a child wrote.
        return 'minor'
    if audience == AUDIENCE_VERIFIED and not _is_verified(user):
        return 'verification_required'
    return None


def held_for(user, policy: dict) -> bool:
    """Whether what this person is about to write waits for a moderator.

    Anonymous is always held (module docstring). Staff are never held — the person who would
    approve it is the person writing it, and a queue containing a moderator's own comment is a
    round trip that answers nothing.
    """
    authenticated = bool(user is not None and getattr(user, 'is_authenticated', False))
    if authenticated and user.is_staff:
        return False
    if not authenticated:
        return True
    return bool(policy['moderated'])


def visible_comments(user, queryset):
    """The thread as this person may read it.

    A **held** comment is not public: its author and staff see it, nobody else does. Holding is
    recorded as `auto_hidden_at` by `accounts.minors.hold_for_review`, which is the whole reason
    this feature needed no new state and no second moderation queue — the existing one already
    knows how to show, restore and remove anything with that field set.

    A **removed** comment is NOT filtered out, deliberately: `CommentSerializer` blanks its body and
    the frontend draws a placeholder, which is what keeps a thread's shape readable when something
    in the middle of it goes (house rule 12). Holding is different in kind — a held comment has
    never been public, so there is nothing to leave a tombstone of.

    An anonymous writer sees their own held comment in the response to their own POST and not
    afterwards: there is no account to tie it to. That is a real limitation of allowing anonymous
    writing at all, and it is named in `todo.md` rather than papered over with a cookie.
    """
    from django.db.models import Q

    authenticated = bool(user is not None and getattr(user, 'is_authenticated', False))
    if authenticated and user.is_staff:
        return queryset
    if authenticated:
        return queryset.filter(Q(auto_hidden_at__isnull=True) | Q(author=user))
    return queryset.filter(auto_hidden_at__isnull=True)
