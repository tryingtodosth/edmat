"""The record of every licence change on a piece of content (house rule 12: keep the record of a
decision). A row is written by `rules.change_licence` and by nothing else; the current licence
itself lives on the content row (`Exercise.licence`, `Material.licence`, …), so a list never needs
this table and a detail page asks it one question: "since when?".

The creation of a piece of content writes NO row: its own `created_at` is the date its first
licence was granted, and a migration that classified ten-thousand legacy rows would otherwise have
had to invent ten-thousand changes nobody made.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from .licences import LICENCE_CHOICES, LICENCE_MAX_LENGTH, DEFAULT_LICENCE


def licence_field(default: str = DEFAULT_LICENCE, **kwargs) -> models.CharField:
    """The `licence` column every licensed model carries — one definition, so the width and the
    choices cannot drift between apps."""
    return models.CharField(
        max_length=LICENCE_MAX_LENGTH,
        choices=LICENCE_CHOICES,
        default=default,
        db_index=True,
        **kwargs,
    )


class LicenceChange(models.Model):
    """One change of one item's licence: from what, to what, by whom, when, and why (a staff
    member marking rights `unknown` has to say why — house rule 6)."""

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    from_licence = models.CharField(max_length=LICENCE_MAX_LENGTH, choices=LICENCE_CHOICES)
    to_licence = models.CharField(max_length=LICENCE_MAX_LENGTH, choices=LICENCE_CHOICES)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    #: True when the change was made with staff authority rather than as the author.
    as_staff = models.BooleanField(default=False)
    note = models.CharField(max_length=500, blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-changed_at', '-id']
        indexes = [models.Index(fields=['content_type', 'object_id', '-changed_at'])]

    def __str__(self) -> str:
        return f'{self.content_type.model}#{self.object_id}: {self.from_licence} -> {self.to_licence}'
