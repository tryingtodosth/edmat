"""Which management rows carry translatable text, and what their two text columns are called.

The registry half of this app's polymorphic target (root CLAUDE.md: "A polymorphic target is a
`GenericForeignKey` plus a registry"). Eight entries, and like every other registry here it is
deliberately its own length: this is the MANAGEMENT layer's text (MANAGEMENT-BRIEF.md), the part
the owner named on 2026-10-08. An exercise, a material and a concept article all have translations
already, through their own per-model tables with a review workflow — see `translations/models.py`
for why that shape and this one are not the same thing.

The second column is `None` for an organisation, whose `name` is a registered name that is the
same in every language; the third is `None` for a poll option and for a goal's criterion, each of
which has one text field and no second one. Nothing infers either: `('decisions', 'polloption')` really does call its field `text`,
a `Poll` calls its first field `question`, and the four others call theirs `title`. A convention
that guessed would be wrong for three of the seven.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType

from decisions.models import Poll, PollOption
from goals.models import Goal, GoalCriterion
from needs.models import Need
from organizations.models import Organization
from plans.models import Plan, PlanStep
from tasks.models import Task

#: kind -> (model, the field holding its heading, the field holding its body or None)
TRANSLATABLE_KIND_MODELS = {
    'task': (Task, 'title', 'description'),
    'plan': (Plan, 'title', 'description'),
    'plan_step': (PlanStep, 'title', 'description'),
    'need': (Need, 'title', 'description'),
    'poll': (Poll, 'question', 'description'),
    'poll_option': (PollOption, 'text', None),
    # The mirror image of a poll option: a body and NO heading. An organisation's `name` is a
    # registered name and the same in every language — "EdMat.net association" does not become
    # something else in Polish — so only the description is written twice. It is in here at all
    # because it is the first paragraph on `/about`, the page the owner was looking at.
    'organization': (Organization, None, 'description'),
    # A goal and one line of its definition of done (`goals/`, 2026-10-08). The criterion is the
    # `poll_option` shape — one text field, no second one — and it is in here rather than left
    # English-only because `/about`'s goals are the most-read management text on the site and a
    # definition of done nobody can read is not a definition of anything.
    'goal': (Goal, 'title', 'description'),
    'goal_criterion': (GoalCriterion, 'text', None),
}

_REVERSE_KIND_MODELS = {model: kind for kind, (model, _h, _b) in TRANSLATABLE_KIND_MODELS.items()}


def model_for(kind: str):
    """The model behind a kind string, or None — callers 404 on None, because a kind is user
    input off a URL."""
    entry = TRANSLATABLE_KIND_MODELS.get(kind)
    return entry[0] if entry else None


def kind_of(obj) -> str:
    """The kind string for an instance, or `''` for a model this registry has never been taught —
    empty rather than an exception, the `community/targets.py` precedent."""
    return _REVERSE_KIND_MODELS.get(type(obj), '')


def fields_of(obj) -> tuple[str, str | None]:
    """`(heading field, body field or None)` for an instance."""
    entry = TRANSLATABLE_KIND_MODELS.get(kind_of(obj))
    return (entry[1], entry[2]) if entry else ('', None)


def own_text(obj) -> tuple[str, str]:
    """What the row's OWN columns say — the original text, and the answer for a target that has no
    `TextVersion` rows at all (which is every row written before this app existed)."""
    heading_field, body_field = fields_of(obj)
    heading = getattr(obj, heading_field, '') if heading_field else ''
    body = getattr(obj, body_field, '') if body_field else ''
    return heading or '', body or ''


def write_own_text(obj, heading: str, body: str) -> list[str]:
    """Mirror the original language onto the row's own columns and return the changed field names,
    for a caller's `save(update_fields=...)`.

    This is what keeps every existing reader of `Task.title` correct — see `models.py`'s own
    "Why the model's own column survives". A poll option takes only the heading, because it has
    nowhere to put a body.
    """
    heading_field, body_field = fields_of(obj)
    changed = []
    if heading_field:
        setattr(obj, heading_field, heading)
        changed.append(heading_field)
    if body_field:
        setattr(obj, body_field, body)
        changed.append(body_field)
    return changed


def content_type_for(kind: str):
    model = model_for(kind)
    return ContentType.objects.get_for_model(model) if model else None
