"""Tutoring/services listings ("Korepetycje") — a user-created, course-scoped offer, distinct from
the lightweight `accounts.Profile.offers_tutoring` flag (a bare opt-in badge with no structure). A
Service is the fuller marketplace-style presence: a real title/description, an optional rate, and
one or more real Courses from the existing taxonomy so a visitor browsing a specific course can
actually discover tutors for THAT course, not just a flat, unstructured list. See CLAUDE.md's own
writeup of this feature for the full design reasoning.
"""

from django.conf import settings
from django.db import models

# A small, fixed set rather than free text — this app is bilingual and university-based (University
# of Warsaw), so PLN is the sensible default, but a rate should still be able to read correctly in
# a couple of other real currencies rather than assuming every provider/visitor is PLN-only.
CURRENCY_CHOICES = [
    ('PLN', 'PLN'),
    ('EUR', 'EUR'),
    ('USD', 'USD'),
]


class Service(models.Model):
    provider = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='services', on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    courses = models.ManyToManyField('taxonomy.Course', related_name='tutoring_services', blank=True)

    # Both optional and deliberately DISPLAY-only — this app has no real payment processing
    # anywhere (matching CLAUDE.md's own "no payment processor, contact via messaging" scope), a
    # provider states a rate as information for a prospective student to see before reaching out,
    # not something the platform itself charges or collects.
    hourly_rate = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default='PLN', blank=True)

    # Lets a provider pause a listing (e.g. during exam season, or once they're fully booked)
    # without losing it outright — same "tombstone, don't hard-delete a real thing a user made"
    # instinct this project already applies elsewhere (Comment's own moderation statuses, a
    # Material's `published` flag), just named for what it means here specifically.
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.title} ({self.provider})'


class ServiceReview(models.Model):
    """A star rating + optional written review on a tutoring listing — the same shape
    `community.models.Review` already establishes for an Exercise, kept as its own parallel model
    (not a generic/GenericForeignKey retrofit of Review itself) rather than reworking an existing,
    tightly-coupled model's own direct `exercise` FK and every call site built against it."""

    service = models.ForeignKey(Service, related_name='reviews', on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    rating = models.PositiveSmallIntegerField()  # 1-5
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # A moderator's own "reports were founded" decision (the report-a-tutor-review feature) —
    # follows `community.Review.is_removed`'s own precedent exactly: a REMOVED review disappears
    # entirely from `service.reviews` reads (services/views.py's `reviews` action, and this
    # serializer's own average_rating/review_count), not a Comment-style tombstone-blank — a
    # ServiceReview is never threaded/replied-to, so there's no structural reason to keep a hidden
    # row visibly present the way a removed Comment's own reply chain needs.
    is_removed = models.BooleanField(default=False)

    class Meta:
        unique_together = [('service', 'author')]  # one review per user per listing
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.rating}★ on {self.service_id} by {self.author}'


class ServiceWatch(models.Model):
    """"Add to watchlist to compare certain listings" — a plain, per-user bookmark on a Service, no
    richer than that: comparing is a frontend concern (rendering several watched listings side by
    side from the same data `GET /api/services/{id}/` already returns), not something this model
    needs its own logic for."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='watched_services', on_delete=models.CASCADE)
    service = models.ForeignKey(Service, related_name='watchers', on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'service')]
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.user} watches {self.service_id}'
