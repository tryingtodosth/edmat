"""CLAUDE.md Section 9: "Django's built-in auth.User plus a Profile ... no need to reinvent auth."

A Profile row is created automatically for every User via a post_save signal (see apps.py), so every
call site that reads request.user.profile can assume it exists rather than defensively creating it.
"""

from django.conf import settings
from django.db import models


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, related_name='profile', on_delete=models.CASCADE)
    display_name = models.CharField(max_length=100, blank=True)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    preferred_locale = models.CharField(max_length=8, default='en')
    is_verified_contributor = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.display_name or self.user.username
