from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Profile


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile(sender, instance, created, **kwargs):
    if created:
        Profile.objects.get_or_create(user=instance)


from django.db.models.signals import pre_delete


@receiver(pre_delete, sender=settings.AUTH_USER_MODEL)
def cascade_children(sender, instance, **kwargs):
    """Deleting a guardian deletes their children too — unless a second guardian remains for a
    child, in which case that child stays (AUDIENCE-BRIEF.md §2)."""
    from .models import Guardianship

    for g in Guardianship.objects.filter(guardian=instance, revoked_at__isnull=True).select_related('child'):
        others = Guardianship.objects.filter(child=g.child, revoked_at__isnull=True).exclude(guardian=instance)
        if not others.exists():
            g.child.delete()
