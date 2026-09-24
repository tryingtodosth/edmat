"""A poll is a formal decision — single or multiple choice, an eligibility rule, open/close.

Decisions are nodes-based: a poll hangs off a course, an event, or a material (through its
co-authoring project). Resolving the node happens through `config.nodes.py`.

The core models: `Poll` (the question), `PollOption` (the answers), `Ballot` (who took part),
`Vote` (what they chose).

The one invariant: **results are always a recount, never a stored tally**. `Vote` rows are the
source of truth; `Ballot` records *who took part*, not *what they chose*.
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models


class Poll(models.Model):
    """A formal decision with voting rules, eligibility, and a deadline."""

    # Polymorphic target through `config.nodes`
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')

    question = models.TextField()
    description = models.TextField(blank=True)  # Sanitized on write

    # single: one choice only; multiple: many choices allowed
    MODE_CHOICES = [
        ('single', 'Single choice'),
        ('multiple', 'Multiple choices'),
    ]
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default='single')

    # Whether ballot rows carry no person identifier (house rule 9: public by construction)
    anonymous = models.BooleanField(default=False)

    # staff: only staff may vote; members: staff and members (enrolled/going/on project)
    ELIGIBILITY_CHOICES = [
        ('staff', 'Staff only'),
        ('members', 'Staff and members'),
    ]
    eligibility = models.CharField(max_length=10, choices=ELIGIBILITY_CHOICES, default='members')

    # Nullable so polls can exist before opening
    opens_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)

    # Lifecycle: draft → open → closed
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('open', 'Open'),
        ('closed', 'Closed'),
    ]
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')

    # When the poll was closed and by whom
    decision_note = models.TextField(blank=True)  # The closing note/decision
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='polls_closed',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    closed_at = models.DateTimeField(null=True, blank=True)

    # Who created it
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='polls_created', on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['content_type', 'object_id']),
        ]

    def __str__(self) -> str:
        return f'Poll: {self.question[:50]} ({self.status})'


class PollOption(models.Model):
    """One answer in a poll."""

    poll = models.ForeignKey(Poll, related_name='options', on_delete=models.CASCADE)
    text = models.TextField()
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['poll', 'order'],
                name='unique_poll_option_order',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.poll.question[:30]} → {self.text[:30]}'


class Ballot(models.Model):
    """A record that a person took part in a poll.

    For anonymous polls, there is no link to see WHO voted for WHAT — the person is known,
    the choice is not. For non-anonymous polls, matching a Ballot to a Vote tells who voted for
    which option.
    """

    poll = models.ForeignKey(Poll, related_name='ballots', on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    cast_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-cast_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['poll', 'user'],
                name='unique_ballot_per_user_per_poll',
            ),
        ]
        indexes = [
            models.Index(fields=['poll', 'user']),
        ]

    def __str__(self) -> str:
        return f'{self.user.email} voted in poll {self.poll.id}'


class Vote(models.Model):
    """A vote for an option in a poll.

    For anonymous polls, `ballot` is NULL — the vote is a row with no link to a person.
    For non-anonymous polls, `ballot` points to the person who cast it.
    """

    poll = models.ForeignKey(Poll, related_name='votes', on_delete=models.CASCADE)
    option = models.ForeignKey(PollOption, related_name='votes', on_delete=models.CASCADE)
    ballot = models.ForeignKey(Ballot, related_name='votes', on_delete=models.CASCADE, null=True, blank=True)

    class Meta:
        ordering = ['-id']
        indexes = [
            models.Index(fields=['poll', 'option']),
        ]

    def __str__(self) -> str:
        return f'Vote: {self.option.text[:30]} in poll {self.poll.id}'
