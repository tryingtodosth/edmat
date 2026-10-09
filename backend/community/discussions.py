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

## A task, a plan, a need or a poll is a location too (2026-10-08)

The owner's ask once `/about` had become the project's own organisation page: "all the edmat
about/project info section with tasks, plans, needs etc should be commentable … as we wanted to do
that with the previous version of about meaning replies and moderation/flags different settings".
The previous version's mechanism IS this module, so the answer was to let a management row be a
page here rather than to give four apps a comment endpoint each: a key of `tasks/17`, `plans/3`,
`needs/2` or `polls/1` — and, since `goals/` landed the same day, `goals/5` — (`MANAGEMENT_PAGE_RE`)
is the `page` of a `DiscussionLocation`, with no
section — one thread per row, one row of settings per row, held comments through the same queue,
and the moderation tab lists them beside the standing pages without learning anything.

Two things ARE different about such a page, and both are answered here so the views stay thin:

- **It can be private.** A standing page is prose anybody can open; a task hangs off a node with a
  roster, and a stranger may not see it at all. `can_read_location` asks the row's own app
  (`tasks.rules.visible_task`, `plans.rules.can_view_plan`, `needs.rules.can_view_need`,
  `decisions.rules.can_view_poll`, `goals.rules.can_view_goal`) and the views turn a refusal into 404 — the same answer the
  row's own endpoint gives (house rule 4). A missing row is the same 404.
- **It answers to two kill switches.** `about_discussions` for the thread, and the row's own
  (`tasks`, `plans`, `needs`, `decisions`, `goals`): a killed board must not keep a live thread under rows
  nobody can reach (house rule 3). `effective_policy` folds the second in for these pages only.

**And a contest's own page (2026-10-09).** `contests/5` joins the list, and it belongs with the
organisation rather than with the four board rows: a contest IS a node, so the thread is the talk
under the thing itself and not under one row of work hung off it. `can_read_location` asks
`contests.access.can_view`, which means a draft contest's thread 404s to everybody but its staff —
the same answer its own endpoint gives — and the `contests` switch closes it with the feature.
Addressed by **pk**, because `/contests/5` is the route (`utils/nodeHref.ts`); the organisation is
the one kind addressed by a slug.

There is no ceiling row for a management page — the node is not a page and no row of this table
stands for it — so "close every thread on this organisation's board" is N switches today, named
in `todo.md`. Plan steps and poll options have no thread of their own; the plan's and the poll's
thread is where that talk goes.

## And so is an organisation's own page (2026-10-08)

The owner's next sentence, the same afternoon: "after the header, the description should be
commentable as well". The header and the description in question are `/about`'s, which is the EdMat
organisation's page (`OrganizationPage.svelte`) — so the thing to make commentable is not a block of
prerendered prose but a row of `organizations.Organization`, and the mechanism is the one the
paragraph above just built. `organizations/edmat` is the `page`, with no section: one thread per
organisation, drawn under its description, and every organisation page gets it rather than `/about`
alone — a student circle's "what we are" is the same kind of text and wants the same thread.

It is addressed by **slug** where the four above are addressed by pk, and that is not an
inconsistency: the slug is this one model's stable public address (`organizations/serializers.py` —
read-only, "allocated once from the name and never moves under a link somebody already sent"), it is
what `/organizations/[slug]` resolves, and a key is also an href (`utils/discussionKeys.ts`). A task
has no such address; its route is `/tasks/17`.

What this deliberately is NOT is the board ceiling the paragraph above says is missing. This row is
the organisation's own thread, not a switch over the threads of its tasks and plans. Making it both
is a defensible future move — "no talking on this organisation" plausibly should mean its board too
— and it is one branch in `effective_policy`; it is left in `todo.md` rather than decided here.

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

#: A management row's own thread: `tasks/17`, `plans/3`, `needs/2`, `polls/1`. Plural words because
#: they are the frontend's route segments (`/tasks/17`), which is where the key sends a reader.
#: A leading zero or an id with more than ten digits is malformed rather than merely absent.
#: `contests/5` (2026-10-09) is here rather than under its own regex for one reason: a contest is a
#: NODE, like an organisation, and a node's own page wanting one thread under it is the question
#: this regex already answers. See `NODE_KINDS_HERE` below for the one thing that is different.
MANAGEMENT_PAGE_RE = re.compile(r'^(tasks|plans|needs|polls|goals|contests)/[1-9][0-9]{0,9}$')

#: An organisation's own page: `organizations/edmat`. A SLUG, not a pk — the module docstring argues
#: why this one model is addressed by its public address and the four above by their id. The shape is
#: `organizations/services.allocate_slug`'s output: lowercase letters, digits and hyphens.
ORGANIZATION_PAGE_RE = re.compile(r'^(organizations)/[a-z0-9-]{1,60}$')

#: The word in the key -> (app_label, model, the kill switch that row answers to). Hand-written
#: like `community/targets.py` and `config/nodes.py`: `polls` live in the `decisions` app and
#: answer to the `decisions` flag, which no convention would have produced.
MANAGEMENT_KINDS = {
    'tasks': ('tasks', 'task', 'tasks'),
    'plans': ('plans', 'plan', 'plans'),
    'needs': ('needs', 'need', 'needs'),
    'polls': ('decisions', 'poll', 'decisions'),
    'organizations': ('organizations', 'organization', 'organizations'),
    'goals': ('goals', 'goal', 'goals'),
    # A contest's own page (`contests/`, CONTESTS-BRIEF.md §3.B, 2026-10-09): one thread under the
    # contest, read by whoever `contests.access.can_view` admits, closed by the `contests` switch.
    'contests': ('contests', 'contest', 'contests'),
}

#: The kinds whose key carries a slug rather than a pk. One set rather than a fifth element on every
#: tuple above, so that adding an id-addressed kind stays a one-line change.
SLUG_KINDS = frozenset({'organizations'})

#: The kinds whose row IS a node (`config/nodes.py`) rather than something hung off one. Their
#: visibility rule reads the row itself, so there is nothing to prefetch — and `prefetch_related
#: ('node')` would raise, because a `Contest` and an `Organization` have no such relation. One set
#: rather than a sixth tuple element, for the same reason `SLUG_KINDS` is one.
NODE_KINDS_HERE = frozenset({'organizations', 'contests'})

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
    if MANAGEMENT_PAGE_RE.match(page) or ORGANIZATION_PAGE_RE.match(page):
        # One thread per row: a section under `tasks/17` would be a thread on nothing, and an
        # organisation's page has one thread under its description for the same reason.
        if section:
            raise ValueError('section')
        return page, ''
    if not PAGE_RE.match(page):
        raise ValueError('page')
    if section and not SECTION_RE.match(section):
        raise ValueError('section')
    return page, section


def management_kind(page: str) -> str | None:
    """`'tasks'` for `tasks/17`, `'organizations'` for `organizations/edmat`, `None` for a standing
    page."""
    match = MANAGEMENT_PAGE_RE.match(page or '') or ORGANIZATION_PAGE_RE.match(page or '')
    return match.group(1) if match else None


def management_rows(pages) -> dict:
    """`{page: row}` for every management page in `pages` whose row exists — one query per KIND,
    not per page, which is what lets the policy endpoint answer for a whole board at once.

    A page whose row is gone is simply absent from the result; the caller treats absent as 404.
    Standing pages are ignored here, not refused.
    """
    from django.apps import apps

    refs_by_kind: dict[str, set[str]] = {}
    for page in pages:
        kind = management_kind(page)
        if kind:
            refs_by_kind.setdefault(kind, set()).add(page.split('/', 1)[1])
    found = {}
    for kind, refs in refs_by_kind.items():
        app_label, model_name, _flag = MANAGEMENT_KINDS[kind]
        model = apps.get_model(app_label, model_name)
        if kind in SLUG_KINDS:
            # An organisation IS a node (`config/nodes.py`), so there is nothing to prefetch: its
            # own row is what its visibility rule reads.
            for row in model.objects.filter(slug__in=refs):
                found[f'{kind}/{row.slug}'] = row
            continue
        queryset = model.objects.filter(pk__in={int(ref) for ref in refs})
        if kind not in NODE_KINDS_HERE:
            # The node comes with the rows — one query per content type rather than one per row, so
            # that the visibility rules' first question (`node_of`, `.node`) costs nothing per row.
            # A kind that IS a node has no `node` relation to prefetch; asking for one raises.
            queryset = queryset.prefetch_related('node')
        for row in queryset:
            found[f'{kind}/{row.pk}'] = row
    return found


def _row_visible(user, kind: str, row) -> bool:
    """Each app's own object-level rule, dispatched by kind. Imported lazily because this module
    is imported by `moderation/services.py`, which those apps import in turn."""
    if kind == 'tasks':
        from tasks.rules import visible_task

        return visible_task(user, row)
    if kind == 'plans':
        from plans.rules import can_view_plan

        return can_view_plan(user, row)
    if kind == 'needs':
        from needs.rules import can_view_need

        return can_view_need(user, row)
    if kind == 'polls':
        from decisions.rules import can_view_poll

        return can_view_poll(user, row)
    if kind == 'goals':
        from goals.rules import can_view_goal

        return can_view_goal(user, row)
    if kind == 'contests':
        from contests.access import can_view

        # A draft contest does not exist for anybody but its staff, so neither does the thread under
        # it — the same 404 `/api/contests/5/` gives them (house rule 4).
        return can_view(user, row)
    if kind == 'organizations':
        from organizations.access import can_view_organization

        # A dissolved organisation is a tombstone its own members may still open (`is_active`), so
        # the thread under its description follows the page: visible to them, 404 to everybody else.
        return can_view_organization(user, row)
    return False


def readable_pages(user, pages, rows: dict | None = None) -> set:
    """The subset of `pages` this reader may open a thread on.

    A standing page is always readable — the prose is public and so is the talk about it. A
    management page, and an organisation's own page, is readable when its row exists and the row's
    own app says so; a stranger on a private course's task is told nothing, exactly as
    `/api/tasks/17/` tells them nothing.
    """
    rows = management_rows(pages) if rows is None else rows
    allowed = set()
    for page in pages:
        kind = management_kind(page)
        if kind is None:
            allowed.add(page)
            continue
        row = rows.get(page)
        if row is not None and _row_visible(user, kind, row):
            allowed.add(page)
    return allowed


def can_read_location(user, page: str) -> bool:
    return page in readable_pages(user, [page])


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


def effective_policy(
    page: str, section: str, rows: dict | None = None, flag_enabled=None
) -> dict:
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

    `rows` is `{section: row}` for THIS page, already fetched, when the caller has many pages to
    answer for at once (`DiscussionPolicyView`'s `keys=` form); left `None`, this fetches its own.
    `flag_enabled` is a stand-in for `is_feature_enabled` for the same caller: that reader asks the
    database every time it is called, so forty keys would be eighty flag reads — the batch passes
    one that remembers (`memoised_flags`).
    """
    if flag_enabled is None:
        flag_enabled = is_feature_enabled
    from .models import DiscussionLocation

    if rows is None:
        rows = {
            row.section: row
            for row in DiscussionLocation.objects.filter(page=page, section__in=['', section])
        }
    page_row = rows.get('')
    section_row = rows.get(section) if section else None

    present = [row for row in (page_row, section_row) if row is not None]

    enabled = flag_enabled(FEATURE_KEY) and all(row.is_enabled for row in present)
    kind = management_kind(page)
    if kind is not None and enabled:
        # The row's own kill switch sits above its thread (module docstring): a killed board must
        # not keep a live thread under rows nobody can reach.
        enabled = flag_enabled(MANAGEMENT_KINDS[kind][2])
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


def memoised_flags():
    """An `is_feature_enabled` that asks the database once per key for the life of one request.

    `moderation.services.is_feature_enabled` deliberately reads the row every call (a kill switch
    must take effect at once), and a view answering one policy per row of a board would ask it
    twice per row. One request is the right lifetime: a flag flipped mid-request is a race nobody
    is waiting on, and the memo dies with the view.
    """
    seen: dict[str, bool] = {}

    def enabled(key: str) -> bool:
        if key not in seen:
            seen[key] = is_feature_enabled(key)
        return seen[key]

    return enabled


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
