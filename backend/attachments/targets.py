"""What an attachment may hang off, and how each target answers "who may see this".

The owner, 2026-10-08: attachments *"in multiple places we lack this funcionality … EVERYWHERE"* —
events (at creation), courses, tasks, plans, needs, goals, materials, organisations and comments.
Asked what to do about the three tables that already answer a piece of that question, they chose
**one table, supersede the others**.

**Two kinds of target, one column pair.** A `GenericForeignKey` plus a hand-written registry is this
project's standing shape for a polymorphic target (`community/targets.py`, `REPORT_KIND_MODELS`,
`GOVERNABLE_NODE_MODELS`, `galleries/visibility.py`), and the registries are deliberately different
lengths. This one has two halves that behave differently and that is why it is written out rather
than derived:

- **A node** — a course, an event, a material, an organisation (`config/nodes.py`). Its standing
  ladder is `view ⊂ member ⊂ staff ⊂ manage`, which is what the visibility tiers map onto.
- **A row that belongs to a node** — a task, a plan, a need, a goal. It has no standing of its own:
  it inherits the node it is hung on, exactly as its own thread does. So this module resolves such a
  row to its node and asks `config/nodes.py` about THAT, rather than teaching four more apps a
  permission model.
- **A comment** — which has no node at all. A comment's attachment is visible to whoever may read
  the comment, which `community` already decides; the tiers do not apply and are refused. A board
  **post** (`activity.Post`, 2026-10-21) is the same shape with a page of its own.

`frontend/src/lib/types/attachment.ts` mirrors `TARGET_KINDS` and says so; adding a kind is a change
to both files.
"""

from __future__ import annotations

from django.apps import apps

from config import nodes

#: kind -> (app_label, model). The four node kinds come from `config.nodes.NODE_KINDS` and are
#: restated here rather than imported wholesale, because this registry is also where the non-node
#: kinds live and a reader should see the whole list in one place.
TARGET_KINDS: dict[str, tuple[str, str]] = {
    'course': ('courses', 'course'),
    'event': ('events', 'event'),
    'material': ('materials', 'material'),
    'organization': ('organizations', 'organization'),
    # A contest (contests/, 2026-10-09): a node kind, so its standing is its own — the regulamin as a
    # PDF, a stage's problem sheet, the jury's protocol all hang here.
    'contest': ('contests', 'contest'),
    'task': ('tasks', 'task'),
    'plan': ('plans', 'plan'),
    'need': ('needs', 'need'),
    'goal': ('goals', 'goal'),
    # A poll (2026-10-10): the fourth board row, added when the row surfaces got their attachment
    # panels and this was the one of the four that could not carry the regulation, the draft or the
    # figures the question is about.
    'poll': ('decisions', 'poll'),
    'comment': ('community', 'comment'),
    # A board post (`activity.Post`, 2026-10-21 — the owner's "post pdfs, imgs, notes, links"):
    # the comment's shape exactly. No node, only the public tier, visible to whoever may read the
    # post, attached to by its author.
    'post': ('activity', 'post'),
}
TARGET_KIND_OF_MODEL = {v: k for k, v in TARGET_KINDS.items()}

#: The kinds whose standing is their own (`config/nodes.py` knows them).
NODE_TARGET_KINDS = frozenset(nodes.NODE_KINDS)
#: The kinds that inherit a node's standing — a board row is not a thing you can be staff *of*.
ROW_TARGET_KINDS = frozenset({'task', 'plan', 'need', 'goal', 'poll'})
#: The kinds with no node behind them at all — a comment, and a board post, which is a comment
#: with a page of its own. Both answer to the person who wrote them and to their own visibility
#: rule, and the tiers do not apply.
COMMENT_TARGET_KINDS = frozenset({'comment', 'post'})


def kind_of(target) -> str | None:
    meta = target._meta
    return TARGET_KIND_OF_MODEL.get((meta.app_label, meta.model_name))


def model_for(kind: str):
    if kind not in TARGET_KINDS:
        return None
    return apps.get_model(*TARGET_KINDS[kind])


def resolve_target(kind: str, pk):
    """The row, or None for an unknown kind or a missing id — the caller turns None into 404."""
    model = model_for(kind)
    if model is None:
        return None
    try:
        pk = int(pk)
    except (TypeError, ValueError):
        return None
    return model.objects.filter(pk=pk).first()


def node_behind(target):
    """The node whose standing decides this target, or None for a comment.

    A board row carries its node as a `GenericForeignKey` of its own (`content_type`/`object_id`,
    the `config/nodes.py` mount), so this is one attribute read and not a per-app branch.
    """
    kind = kind_of(target)
    if kind in NODE_TARGET_KINDS:
        return target
    if kind in ROW_TARGET_KINDS:
        return getattr(target, 'node', None) or getattr(target, 'content_object', None)
    return None
