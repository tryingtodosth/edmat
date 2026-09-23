"""A shift bound to a session follows it.

The programme is edited far more often than the rota is — a room swaps, a keynote slides by
twenty minutes — and a rota that quietly kept the old hours is worse than no rota at all: the
volunteer turns up to an empty room and the organiser believes the door is staffed.

**Only shifts with `follows_session` move.** A shift somebody gave its own hours to (splitting a
three-hour session into two shifts so nobody stands there the whole afternoon) is a deliberate
act, and a programme edit has no business undoing it.

`QuerySet.update()` fires no signal of its own, so a `Shift` moved this way does not re-run
`Shift.save()` — which is fine here (that method's only job is to copy the session's hours, which
is exactly what this does) and is stated rather than hidden, per house rule 5's own note.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from events.models import Session

from .models import Shift


@receiver(post_save, sender=Session)
def session_moved(sender, instance, created, **kwargs):
    if created:
        return
    Shift.objects.filter(station__session=instance, follows_session=True).update(
        starts_at=instance.starts_at, ends_at=instance.ends_at
    )
