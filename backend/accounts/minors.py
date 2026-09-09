"""Minor-safe defaults (AUDIENCE-BRIEF.md §2), enforced server-side.

GDPR Article 8 as transposed in Poland sets the consent age at 16. A child under 16 cannot
register alone; a guardian creates the account (`Guardianship`) and the child logs in with a
username and password and no email. What a minor may NOT do is decided here, in one place, and
every endpoint that grants one of these abilities asks this module rather than remembering the
rule itself:

- no messaging, in either direction;
- no public profile (locked private), no avatar upload, no location sharing (geocoding);
- no tutoring listing, no event hosting;
- comments and posts are allowed but HELD for a moderator's look before anybody else sees them
  (`hold_for_review`) — the ordinary review posture, never the auto-publish exemption.
"""

from django.contrib.contenttypes.models import ContentType
from django.utils import timezone

CONSENT_AGE = 16


def is_minor(user) -> bool:
    if not (user and getattr(user, 'is_authenticated', False)):
        return False
    profile = getattr(user, 'profile', None)
    return bool(profile and profile.is_minor)


def guardian_of(guardian, child) -> bool:
    from .models import Guardianship

    return Guardianship.objects.filter(guardian=guardian, child=child, revoked_at__isnull=True).exists()


HOLD_REASON = 'held_for_review'


def hold_for_review(obj, author) -> bool:
    """Hide `obj` until a moderator restores it, and put it in the moderation queue as a report
    filed in the author's own name with a fixed reason — the queue already knows how to show,
    restore and remove anything with `auto_hidden_at`, so a held item is one more row there
    rather than a second queue. Returns whether anything was held."""
    from moderation.models import Report

    if getattr(obj, 'auto_hidden_at', None) is not None:
        return False
    obj.auto_hidden_at = timezone.now()
    obj.save(update_fields=['auto_hidden_at'])
    content_type = ContentType.objects.get_for_model(type(obj))
    Report.objects.get_or_create(
        content_type=content_type, object_id=obj.pk, reported_by=author, defaults={'reason': HOLD_REASON}
    )
    return True


def should_hold_post(post) -> bool:
    """A minor's post, or a picture posted into a minor band (§2: pre-publication image review)."""
    from config.audience import MINOR_AUDIENCES

    if is_minor(post.author):
        return True
    return bool(post.image) and post.audience in MINOR_AUDIENCES
