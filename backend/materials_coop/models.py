"""One row per project: how open its cooperation is, and what the team says to newcomers.

Hung off `coauthoring.MaterialProject` by a `OneToOneField` of its own rather than as columns on
it — the shape the conference layer used to grow seven apps off `events.Event` at once
(`CONFERENCE-BRIEF.md`). `coauthoring` keeps its schema and its tests; this app owns the policy and
asks nothing of the other one except to be consulted (`policy.py`).

**A project with no row is an `open` project.** That is today's behaviour for every one of the
backfilled corpus projects — anybody signed in may propose a version, and a published material
takes improvements rather than applicants — so the default has to be the absence of a row, not a
data migration that writes 700 identical ones.
"""

from django.conf import settings
from django.db import models

from config.sanitize import sanitize_content

# Mirrored on the frontend in `lib/types/materialsCoop.ts` and labelled in
# `lib/components/coop/labels.ts` (root CLAUDE.md house rule 13: say it in both places).
POLICY_CHOICES = [
    # Anybody signed in may propose a version; the team decides. The default, and what every
    # project behaved like before this app existed.
    ('open', 'Open — anyone may propose a change'),
    # Only co-authors change it; outsiders may ask to join, and a proposal from an outsider is
    # refused with `members_only`.
    ('request', 'By request — ask to join, then edit'),
    # Only co-authors change it, and the team is not taking applications.
    ('closed', 'Closed — co-authors only'),
]
DEFAULT_POLICY = 'open'
POLICY_KEYS = tuple(key for key, _ in POLICY_CHOICES)

WELCOME_NOTE_MAX_LENGTH = 2000


class CoopSettings(models.Model):
    project = models.OneToOneField(
        'coauthoring.MaterialProject',
        on_delete=models.CASCADE,
        related_name='coop',
    )
    policy = models.CharField(max_length=10, choices=POLICY_CHOICES, default=DEFAULT_POLICY)
    # What a would-be contributor reads on the cooperation page before proposing or asking to
    # join. Markdown + HTML passthrough like every other body here; sanitized on write (house rule 8).
    welcome_note = models.TextField(blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'cooperation settings'
        verbose_name_plural = 'cooperation settings'

    def save(self, *args, **kwargs):
        self.welcome_note = sanitize_content(self.welcome_note or '')[:WELCOME_NOTE_MAX_LENGTH]
        super().save(*args, **kwargs)

    def __str__(self):
        return f'coop({self.project_id}, {self.policy})'
