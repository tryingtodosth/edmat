"""Every rule `goals` asks, in one module (root `CLAUDE.md`, boundary 2). The node-side half of
every answer is asked of `config/nodes.py` and never re-derived here: this module knows what a goal
is and nothing about what a course is.

## `met` is DERIVED, and that is the whole feature

Nothing sets a goal to `met`. `recount` does, from its criteria, and it is the only writer — the
`needs.rules.recount` shape and the same reason (house rule 5): a status somebody can tick by hand
is a status that stops meaning anything, and "done" is the one word on this surface that has to be
worth something. So:

    every criterion met, and there is at least one   ->  met
    a criterion re-opened while the goal said met    ->  open
    no criteria at all                              ->  stays open, forever, by construction

The third line is the refusal the owner's ask needs and it needs no refusal word: a goal that has
never said what done means cannot be met, because there is nothing to have met. `abandoned` is left
alone in both directions, exactly as `recount` leaves a `cancelled` need alone — giving up on a goal
is a person's decision and a stray tick must not undo it.

`GoalSerializer.validate_status` refuses a hand-written `met` with the reason, which is the other
half of this: a client that tries is told why rather than silently ignored (house rule 10).

## Two tiers of authority, because they are two different acts

| act | who | refusal |
|---|---|---|
| write the goal, its words, its criteria, its order, abandon it | the node's **manager**, or the goal's own author | `not_manager` |
| tick a criterion off, or un-tick it | the node's **staff** | `not_staff` |

The split is the `plans` precedent (a node manager or the plan's creator edits; ordinary staff
read) widened by one act: somebody doing the work is exactly who knows a criterion is now true, and
making them ask a manager to record it is how a definition of done goes stale. Writing what done
MEANS stays with whoever is accountable for the goal.

## Visibility is the node's, and nothing narrower

A goal is a public statement of what a body is trying to achieve — that is the whole point of the
list on `/about` — so anyone who can view the node can read its goals, `abandoned` ones included
(house rule 12: the record of a decision stays). It deliberately does NOT follow `tasks`, which is
staff-only unless the board is open: a task board is the inside of a team, and a goal is the outside.
There is also no draft state, which is named in `todo.md` rather than invented here.
"""

from django.utils import timezone

from config import nodes

from .models import Goal

#: Refusal words — constants rather than literals at the call sites, so a rename is one edit and a
#: typo is an ImportError rather than a refusal nobody has a sentence for. `labels.ts` has a line
#: for each (house rule 6, house rule 13).
NOT_MANAGER = 'not_manager'
NOT_STAFF = 'not_staff'
NOT_ALLOWED = 'not_allowed'
ILLEGAL_TRANSITION = 'illegal_transition'
#: `delete_block_reason`. Two words, not one boolean: "somebody is working towards this" and
#: "people have been talking about this" are the same refusal to a boolean and two completely
#: different sentences to a person (house rule 6).
HAS_WORK = 'has_work'
HAS_COMMENTS = 'has_comments'

#: A task or a plan naming a goal that hangs off a different node. Its own word because it is not
#: "you may not" — the person may well manage both — it is "these two are not about the same thing".
OTHER_NODE = 'other_node'

#: What a person may set by hand. `met` is in neither column: `recount` owns it.
HAND_TRANSITIONS = frozenset(
    {
        ('open', 'abandoned'),
        ('abandoned', 'open'),
        # Giving up on something already met is a real decision — a goal can be met and then stop
        # being worth pursuing — so it stays.
        ('met', 'abandoned'),
    }
)
# `met -> open` is NOT in there, and that is the point of the whole app: a goal the criteria say is
# met cannot be re-opened by asserting it. Un-tick the criterion that is not actually true, or
# change what the definition of done says, and `recount` follows. A hand move gets
# `illegal_transition` (409) with its reason.


def _authenticated(user) -> bool:
    return bool(user and getattr(user, 'is_authenticated', False))


def node_of(goal):
    """The course / event / material / organisation this goal hangs on, or None if the row it
    named is gone. A dangling generic target is not an error to raise — it is a goal nobody can
    see, which is what every caller below turns it into."""
    return goal.node


# ---- visibility -------------------------------------------------------------------------------


def visible_goals(user, node):
    """The goals of one node, for the nested list — house rule 4's queryset half. Everything,
    because a goal is public on a node you can view (module docstring)."""
    if node is None or not nodes.can_view_node(user, node):
        return Goal.objects.none()
    return Goal.objects.filter(
        content_type=nodes.node_content_type(node), object_id=node.pk
    )


def can_view_goal(user, goal) -> bool:
    """The same rule for a goal that arrives with its id in the URL — `/api/goals/{id}/`, and the
    thread under it (`community/discussions.py`). House rule 4's object-level half: a queryset
    filter never runs for a single-object action, and this app cannot express "on a node I can
    view" as SQL — the target is a `GenericForeignKey` across four models with four different
    rules, so the join does not exist."""
    node = node_of(goal)
    if node is None:
        return False
    return nodes.can_view_node(user, node)


# ---- authority --------------------------------------------------------------------------------


def can_edit(user, goal) -> bool:
    """Write the goal's words, its criteria and its order, or abandon it. A node manager or the
    goal's own author — the `plans.rules.can_edit` pair, for the same reason: ordinary staff read a
    goal and do not get to redefine what done means."""
    node = node_of(goal)
    if node is None:
        return False
    if nodes.can_manage_node(user, node):
        return True
    return _authenticated(user) and goal.created_by_id == getattr(user, 'id', None)


def can_tick(user, goal) -> bool:
    """Record a criterion as met, or un-record it. The node's staff, widened from `can_edit` on
    purpose (module docstring): whoever is doing the work is who knows the criterion is now true."""
    node = node_of(goal)
    if node is None:
        return False
    return nodes.is_node_staff(user, node)


def transition_block_reason(goal, to_status: str) -> str | None:
    """Why `goal.status` may not become `to_status` by hand — or `None`, meaning go ahead.

    `met` is never in the answer's favour: it is derived (`recount`), and a request for it is
    refused by the serializer with its own reason before this is ever asked.
    """
    if to_status == goal.status:
        return ILLEGAL_TRANSITION
    if (goal.status, to_status) not in HAND_TRANSITIONS:
        return ILLEGAL_TRANSITION
    return None


# ---- the definition of done -------------------------------------------------------------------


def recount(goal: Goal) -> None:
    """Recompute `goal.status` between `open` and `met` from its criteria — the ONLY writer of
    `met` (module docstring, house rule 5).

    A single WHERE-anchored `update()` (`backend/CLAUDE.md`'s SQLite rule), not a blind save: a
    second recount racing this one loses cleanly rather than overwriting a status that moved again
    in between. `met_by` is left to the caller, which knows who ticked the criterion that closed it;
    `met_at` is set here because it is a fact about this moment.
    """
    if goal.status == 'abandoned':
        return
    met, total = goal.criteria_counts()
    if total > 0 and met == total:
        target = 'met'
    elif goal.status == 'met':
        target = 'open'
    else:
        target = goal.status
    if target == goal.status:
        return
    now = timezone.now()
    changed = Goal.objects.filter(pk=goal.pk, status=goal.status).update(
        status=target,
        met_at=now if target == 'met' else None,
        met_by=goal.met_by_id if target == 'met' else None,
        updated_at=now,
    )
    if changed:
        goal.status = target
        goal.met_at = now if target == 'met' else None
        if target != 'met':
            goal.met_by = None


def delete_block_reason(goal: Goal) -> str | None:
    """Why this goal cannot be deleted outright — or `None`, meaning it can.

    `abandoned` is the tombstone for a goal that *happened* (house rule 12), and it is the right
    answer for anything a reader may have seen, pointed work at or argued about. It is the wrong
    answer for a goal somebody typed by mistake a minute ago: that row never meant anything, and a
    board that accumulates "Abandoned: Untitlde" forever is a board people stop reading.

    So this is the `sweep_discussion_locations` test applied to a goal — a row nobody decided
    anything about loses no decision when it goes:

        a task or a plan serves it   ->  has_work      (it is part of somebody's plan; abandon it)
        its thread has any comment   ->  has_comments  (people talked here; the thread must resolve)

    Deliberately NOT a condition on `status` or on the criteria: a definition of done nobody has
    pointed work at or discussed is just text its author wrote, and whether they got as far as
    ticking a line says nothing about whether anybody else is relying on it.
    """
    if goal.tasks.exists() or goal.plans.exists():
        return HAS_WORK

    from django.contrib.contenttypes.models import ContentType

    from community.models import Comment, DiscussionLocation

    # Any comment at all, tombstones and held rows included: a removed comment is a placeholder in
    # a thread that still has to resolve, and a held one is a moderator's open question. This is
    # the one count on this surface that is deliberately not "public comments only".
    location = DiscussionLocation.objects.filter(page=f'goals/{goal.pk}', section='').first()
    if location is not None and Comment.objects.filter(
        content_type=ContentType.objects.get_for_model(DiscussionLocation), object_id=location.pk
    ).exists():
        return HAS_COMMENTS
    return None


def goal_for_node(goal_id, content_type_id: int, object_id: int) -> Goal:
    """The goal a task or a plan says it serves, refused if it hangs off a different node.

    **Both `tasks` and `plans` ask this** rather than each checking for itself (house rule 13 —
    said in all three files): a cross-node link cannot be a database constraint, because the two
    ends are two generic targets with no shared column, so the rule has to live somewhere and two
    copies of it is how one of the two surfaces starts allowing it.

    Raises `ValueError(OTHER_NODE)` for a goal on another node and `ValueError(NOT_ALLOWED)` for a
    goal that does not exist — the caller turns both into a 400 naming the field, because the id
    came out of a request body rather than a URL.
    """
    goal = Goal.objects.filter(pk=goal_id).first()
    if goal is None:
        raise ValueError(NOT_ALLOWED)
    if goal.content_type_id != content_type_id or goal.object_id != object_id:
        raise ValueError(OTHER_NODE)
    return goal
