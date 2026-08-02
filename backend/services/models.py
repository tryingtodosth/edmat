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

# How a tutor actually meets a student. Three values, not a pair of booleans (`is_online`/
# `is_in_person`): two booleans make an illegal fourth state representable — neither set, a listing
# nobody can attend — which every read site would then have to defend against. A single choice field
# cannot express that at all.
#
# `hybrid` is a real third answer rather than a convenience: "I teach online, and in person if you
# come to Warsaw" is a genuinely common offer, and collapsing it into either of the other two would
# lose real information a student filters on.
DELIVERY_MODE_CHOICES = [
    ('online', 'Online only'),
    ('in_person', 'In person only'),
    ('hybrid', 'Online or in person'),
]

# The two modes for which a location is meaningful — used by the serializer's own validation and by
# the `?delivery_mode=`/`?near=` filters, so "does this listing need a place?" has ONE definition
# rather than a repeated `in ('in_person', 'hybrid')` scattered across call sites that could drift.
IN_PERSON_MODES = frozenset({'in_person', 'hybrid'})


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

    # Where and how the tutoring actually happens. `default='online'` is what makes this migration
    # safe for the listings that already exist: every one of them predates the field and made no
    # claim about location at all, so the only honest default is the mode that requires none.
    # Backfilling them as in-person would invent a location none of them ever declared.
    delivery_mode = models.CharField(
        max_length=12, choices=DELIVERY_MODE_CHOICES, default='online'
    )

    # Set only when `delivery_mode` is in-person or hybrid (enforced by ServiceWriteSerializer, which
    # also CLEARS all three when a listing switches back to online-only — a stale pin left behind on
    # an online listing would render a map for a place the tutoring no longer happens).
    #
    # `location_label` is the human-readable address; it is stored rather than re-derived on read
    # because reverse-geocoding on every page render would hammer Nominatim for a string that never
    # changes, and its usage policy explicitly forbids exactly that. It is also what still displays
    # correctly if the geocoding service is ever unavailable.
    location_label = models.CharField(max_length=300, blank=True)
    # `DecimalField`, not `FloatField`: coordinates are compared and round-tripped through JSON, and
    # binary float drift in the last places is a real (if small) source of "the pin moved slightly"
    # bugs. 6 decimal places is ~11 cm at the equator — far finer than a street address needs, and
    # the precision Nominatim itself returns.
    location_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_lon = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    @property
    def is_in_person(self) -> bool:
        return self.delivery_mode in IN_PERSON_MODES

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
