"""`Goal` — what a course, an event, a material or an organisation is trying to achieve, and
`GoalCriterion` — the conditions that say it has been achieved.

The owner's ask, 2026-10-08: *"we also need goal class which is going to be used as a definition of
done and also commentable"*. The word "goal" was already in use here as a CONVENTION — `/about`
calls the twelve module plans the project's goals (`work/edmat_project.py`, "a goal is a plan on the
EdMat organisation") — and a convention is exactly what this app replaces: a goal is now a row, with
a definition of done that a person can disagree with in writing.

## The criteria ARE the definition of done

A `Goal` has no `definition_of_done` text column. It has an ordered list of `GoalCriterion` rows, and
that list is the definition — which is the difference between a goal somebody can check and a
paragraph somebody can interpret. Two consequences, and both are the point:

- **A goal cannot be `met` while a criterion is open.** `rules.meet_block_reason` is the gate and it
  carries its reason (house rule 6): `criteria_open` with the number still open, or `no_criteria` for
  a goal that has never said what done means. The second refusal is deliberate rather than permissive
  — a goal with an empty definition of done is not met, it is unstated, and letting somebody tick it
  would make "met" mean nothing on the one surface the word has to be worth something.
- **A criterion's state is ONE nullable timestamp**, `met_at`, with `met_by` beside it. Not a
  boolean plus a date, which would make "met, but nobody knows when" representable, and not a
  `status` field, because a criterion has exactly two states and `met_at IS NULL` is already the
  honest spelling of one of them (root `CLAUDE.md`, the lifecycle shape, applied in its smallest
  case). `is_met` is a property over it and nothing stores it.

`Goal.status` IS a status field, because a goal has three states and the third is not the absence of
the second: `open`, `met`, `abandoned`. `met_by`/`met_at` are set when it reaches `met` and cleared
when it leaves, the `PlanStep.done_by` shape — "met" is a fact about a moment, not only a word.

## The node, and nothing but the node

The node is a `GenericForeignKey` resolved through `config/nodes.py`, like every other management
app (MANAGEMENT-BRIEF.md §4 rule 1): no field is added to `Course`, `Event`, `Material` or
`Organization`. What this app DOES add elsewhere is one nullable FK on `tasks.Task` and one on
`plans.Plan` — the "serves" link the owner's own sketch asked for — and `rules.goal_for_node` is the
single place that refuses a task on one node pointing at a goal on another. A cross-node link cannot
be a database constraint (two generic targets, no shared column), so it is a rule both apps ask,
which is what keeps the two serializers from drifting into two answers.

## The text is bilingual, like every other management row

`title`, `description` and a criterion's `text` are management text, so they go through
`translations.TextVersion` (`translations/targets.py`, 2026-10-08) rather than being written once in
whatever language the author had to hand. A criterion is the `poll_option` shape in that registry —
one text field and no second one.

`frontend/src/lib/utils/labels.ts` mirrors `GOAL_STATUS_CHOICES` (house rule 13 — said in both
files).
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey, GenericRelation
from django.contrib.contenttypes.models import ContentType
from django.db import models

from config.sanitize import sanitize_content

#: Mirrored in `frontend/src/lib/types/goal.ts` and labelled in `frontend/src/lib/utils/labels.ts`
#: (house rule 13 — say so in both places). `abandoned` rather than `cancelled`, which is what a
#: booking is: a goal that is given up on was still a goal, and the row stays as the record of what
#: was wanted (house rule 12).
GOAL_STATUS_CHOICES = [
    ('open', 'Open — being worked towards'),
    ('met', 'Met — every criterion is met'),
    ('abandoned', 'Abandoned — no longer being worked towards'),
]

#: A criterion is one checkable sentence, not an essay: if it needs paragraphs it is two criteria,
#: or it belongs in the goal's own description. A hard bound rather than a convention, because this
#: is the text a reader scans as a list.
CRITERION_MAX_LENGTH = 300


class Goal(models.Model):
    """One thing a node is trying to achieve, with its definition of done hanging off it."""

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    #: Every language this row's text has been written in (`translations.TextVersion`). A reverse
    #: accessor only — it adds no column and so needs no migration — and it is what keeps resolution
    #: off the N+1 path: a view prefetches it once and `translations.resolve` then does no queries.
    #: The two text fields above stay the ORIGINAL language.
    text_versions = GenericRelation('translations.TextVersion')

    status = models.CharField(max_length=10, choices=GOAL_STATUS_CHOICES, default='open')
    #: Hand-ordered, because a node's goals are a short list somebody has put in an order that
    #: means something ("first this, then that"), unlike its tasks, which are ordered by when they
    #: are due. Ties fall back to `id`, so an unordered list is still stable.
    order = models.PositiveIntegerField(default=0)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='goals_created', null=True, blank=True,
        on_delete=models.SET_NULL,
    )
    #: Set when `status` becomes `met` and cleared when it leaves (`views.py`), the `PlanStep`
    #: shape: separate from `status` because "met" is a fact about a moment, not only a word.
    met_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='goals_met', null=True, blank=True,
        on_delete=models.SET_NULL,
    )
    met_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'id']
        indexes = [models.Index(fields=['content_type', 'object_id'])]

    def __str__(self) -> str:
        return f'{self.title} ({self.status})'

    def save(self, *args, **kwargs):
        # Sanitized on write like every other rich-text field (config/sanitize.py) — the API is an
        # independent entry point, and whoever reads this later is rendering untrusted HTML
        # (house rule 8).
        self.description = sanitize_content(self.description)
        super().save(*args, **kwargs)

    def criteria_counts(self) -> tuple[int, int]:
        """`(met, total)` straight from the database — what `rules.recount` decides `met` from.

        Two counts over an indexed FK are cheap and a recount cannot drift; a stored "3 of 5" that
        one code path forgets to update is wrong forever (house rule 5).

        **Deliberately NOT `self.criteria.count()`.** A related manager whose relation has been
        prefetched answers from the prefetch cache, so a goal loaded by a view that prefetched its
        criteria and then had one ADDED counted the old list and stayed `met` — a recount that reads
        a cache is not a recount. Caught by `goals.tests.DefinitionOfDoneTests.
        test_adding_an_open_criterion_reopens_a_met_goal`. Read-time counts for a serializer come
        from `criteria_counts_cached` instead, which is the one place the cache is the right answer.
        """
        rows = GoalCriterion.objects.filter(goal_id=self.pk)
        return rows.filter(met_at__isnull=False).count(), rows.count()

    def criteria_counts_cached(self) -> tuple[int, int]:
        """`(met, total)` over whatever `criteria` is already holding — the prefetched list in a
        serializer, which is the same list the response is about to print. Zero queries where the
        view has prefetched, and never used to DECIDE anything (see `criteria_counts`)."""
        rows = list(self.criteria.all())
        return sum(1 for row in rows if row.is_met), len(rows)


class GoalCriterion(models.Model):
    """One condition of a goal's definition of done. Met or not; `met_at IS NULL` is "not"."""

    goal = models.ForeignKey(Goal, related_name='criteria', on_delete=models.CASCADE)
    text = models.CharField(max_length=CRITERION_MAX_LENGTH)
    #: The `poll_option` shape in `translations/targets.py`: one text field, no second one.
    text_versions = GenericRelation('translations.TextVersion')
    order = models.PositiveIntegerField(default=0)

    met_at = models.DateTimeField(null=True, blank=True)
    met_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='goal_criteria_met', null=True, blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']
        indexes = [models.Index(fields=['goal', 'order'])]

    def __str__(self) -> str:
        return f'{self.text[:40]} ({"met" if self.is_met else "open"})'

    @property
    def is_met(self) -> bool:
        return self.met_at is not None

    def save(self, *args, **kwargs):
        # A criterion is a plain sentence, but it travels through the same sanitizer as every other
        # user string here: the API is a second entry point and this text is rendered in a list a
        # moderator also reads.
        self.text = sanitize_content(self.text)
        super().save(*args, **kwargs)
