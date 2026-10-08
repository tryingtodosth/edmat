"""May this person write this row's text?

**Asked of the target's own app, never answered here.** Each of the five management apps already
has the real answer, each one different in a way that matters, and a second copy of any of them in
this app would be the start of two surfaces disagreeing about who may edit a task:

| kind | asks | and so admits |
|---|---|---|
| `task` | `tasks.rules.can_edit` | the node's manager, the task's author, **or whoever is carrying it** |
| `plan`, `plan_step` | `plans.rules.can_edit` | the node's manager, or the plan's own author |
| `need` | `needs.rules.can_manage` | the node's manager |
| `goal`, `goal_criterion` | `goals.rules.can_edit` | the node's manager, or the goal's own author |
| `poll`, `poll_option` | `config.nodes.can_manage_node` on the poll's node, **and only while it is a draft** | the node's manager |
| `organization` | `organizations.access.can_manage_organization` | its owners and admins |

The task row is the one worth reading twice: an assignee may fix the words of the thing they are
doing, which `tasks/rules.py` explains is the whole point of that third party existing. Translating
is editing, so the same three people may do it, and the owner's instruction (*"mods/admins can edit
and submit edit/new stuff"*) is satisfied by those answers rather than by a new role.

The poll carve-out is not this module's invention either: `decisions/views.py` refuses a PATCH to a
poll that has left `draft` with a 409, because an open poll's question is what people have already
voted on. Translating it afterwards would change the question under them, so the same refusal
applies here and carries the same reason (house rule 6).
"""

from __future__ import annotations

from .targets import kind_of

#: The reason a refusal gives back, so the frontend can say "this poll is already open" rather
#: than "no".
NOT_DRAFT = 'poll_not_draft'
NOT_ALLOWED = 'not_allowed'
UNKNOWN_KIND = 'unknown_kind'


def write_block_reason(user, obj) -> str | None:
    """`None` when this person may write this row's text, else the word that says why not."""
    if not (user is not None and getattr(user, 'is_authenticated', False)):
        return NOT_ALLOWED
    kind = kind_of(obj)

    if kind == 'task':
        from tasks import rules as task_rules

        return None if task_rules.can_edit(user, obj) else NOT_ALLOWED

    if kind == 'plan':
        from plans import rules as plan_rules

        return None if plan_rules.can_edit(user, obj) else NOT_ALLOWED

    if kind == 'plan_step':
        from plans import rules as plan_rules

        plan = getattr(obj, 'plan', None)
        if plan is None:
            return NOT_ALLOWED
        return None if plan_rules.can_edit(user, plan) else NOT_ALLOWED

    if kind == 'need':
        from needs import rules as need_rules

        return None if need_rules.can_manage(user, obj) else NOT_ALLOWED

    if kind in ('goal', 'goal_criterion'):
        from goals import rules as goal_rules

        # The words of a goal, and the words of one line of its definition of done, are the same
        # question: `goals.rules.can_edit` — the node's manager or the goal's own author. NOT
        # `can_tick`, which is wider on purpose (staff may record that a criterion is met) and has
        # nothing to do with rewriting what it says.
        goal = obj if kind == 'goal' else getattr(obj, 'goal', None)
        if goal is None:
            return NOT_ALLOWED
        return None if goal_rules.can_edit(user, goal) else NOT_ALLOWED

    if kind == 'organization':
        from organizations.access import can_manage_organization

        return None if can_manage_organization(user, obj) else NOT_ALLOWED

    if kind in ('poll', 'poll_option'):
        from config.nodes import can_manage_node
        from decisions import rules as poll_rules

        poll = obj if kind == 'poll' else getattr(obj, 'poll', None)
        if poll is None:
            return NOT_ALLOWED
        node = poll_rules.poll_node(poll)
        if node is None or not can_manage_node(user, node):
            return NOT_ALLOWED
        # The same refusal `decisions/views.py` already makes to a PATCH, for the same reason: an
        # open poll's question is what people have voted on.
        return None if poll.status == 'draft' else NOT_DRAFT

    return UNKNOWN_KIND


# There is deliberately NO `can_read` here, and no GET endpoint for a row's versions.
#
# Every version a client needs arrives embedded in the row it belongs to — each of the four apps'
# serializers carries `text` (the resolved reading) and `text_versions` (all of them, for the
# side-by-side editor to fill both columns from). Those serializers are reached through querysets
# that have ALREADY applied the row's own visibility (`visible_tasks`, `visible_plans`,
# `public_needs`, `visible_polls`), so the text is exactly as visible as the thing it is the text
# of, with no second rule to keep in step.
#
# A standalone read endpoint would have needed its own copy of four different visibility answers,
# which is the one thing this module exists to avoid.
