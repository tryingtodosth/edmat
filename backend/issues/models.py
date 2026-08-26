"""Site issue reports — "Report issue / Zgłoś błąd" — and what makes them distinct from
`moderation.Report`.

A `Report` flags one piece of content (an exercise, a comment, a review) so a moderator can decide
whether it stays. An `Issue` is about the SITE: something broken, a wrong solution the reporter
cannot point a moderation report at, an idea, anything else — filed from wherever the person was
standing when it occurred to them, which is why the page they were on travels with it.

Three decisions worth stating, because each was asked and answered:

- **Anonymity is real, not cosmetic.** An anonymous report stores no reporter and no email — not
  "hidden from the public but kept for staff". The cost is that nobody can follow up with that
  person, and the settings copy says so. A guest can report too; they are anonymous unless they
  leave an email.
- **Publication is the reporter's choice.** An issue the reporter did not allow to be published is
  visible to staff only, ever; a published one has a page of its own with a discussion thread. The
  reporter — when there is one — is told when its status changes, which is what they get instead of
  being able to revisit a private report.
- **Status is one field**, not `is_resolved` + `is_closed`, for the reason every other status in
  this codebase gives: two booleans make an illegal fourth state representable.
"""

from django.conf import settings
from django.db import models

ISSUE_KIND_CHOICES = [
    ('bug', 'Something is broken'),
    ('content', 'Wrong or misleading content'),
    ('idea', 'An idea or suggestion'),
    ('other', 'Something else'),
]

ISSUE_STATUS_CHOICES = [
    ('open', 'Open'),
    ('in_progress', 'In progress'),
    ('resolved', 'Resolved'),
    ('closed', 'Closed without action'),
]


class Issue(models.Model):
    kind = models.CharField(max_length=10, choices=ISSUE_KIND_CHOICES, default='bug')
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    # Where the person was when they filed it, captured by the client by default and editable
    # before sending: the page path, its title, the interface locale, the viewport and the browser.
    # A dict rather than five columns because it is context for a human reading the report, never
    # something this app queries by.
    context = models.JSONField(default=dict, blank=True)
    # NULL for an anonymous report — genuinely absent, not hidden (see the module docstring) — and
    # for a guest. SET_NULL, so deleting an account turns their reports anonymous rather than
    # deleting the record of a real problem.
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        related_name='issues',
        on_delete=models.SET_NULL,
    )
    # The one way a guest who wants a reply can be reached. Blank on an anonymous report.
    contact_email = models.EmailField(blank=True)
    # The reporter's own answer to "may this be published?". Staff can flip it off afterwards
    # (a report that turns out to contain somebody's personal data), never on.
    is_public = models.BooleanField(default=False)
    status = models.CharField(max_length=12, choices=ISSUE_STATUS_CHOICES, default='open')
    # What staff said when they changed the status — shown on the issue page and carried in the
    # reporter's notification.
    staff_note = models.TextField(blank=True)
    status_changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'[{self.kind}/{self.status}] {self.title}'
