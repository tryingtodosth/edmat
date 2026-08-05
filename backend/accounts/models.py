"""CLAUDE.md Section 9: "Django's built-in auth.User plus a Profile ... no need to reinvent auth."

A Profile row is created automatically for every User via a post_save signal (see apps.py), so every
call site that reads request.user.profile can assume it exists rather than defensively creating it.
"""

from django.conf import settings
from django.db import models

from .avatar import validate_avatar_file


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, related_name='profile', on_delete=models.CASCADE)
    display_name = models.CharField(max_length=100, blank=True)
    # `validators=` is defense in depth for the ONE write path that bypasses the API: the Django
    # admin, which assigns this field directly and so never reaches `AvatarView`/`process_avatar`.
    # It gives that path the size/content-type/decompression-bomb checks but NOT the re-encode, which
    # is why the API deliberately does not rely on it — see accounts/avatar.py's own doc comment.
    avatar = models.ImageField(
        upload_to='avatars/', blank=True, null=True, validators=[validate_avatar_file]
    )
    preferred_locale = models.CharField(max_length=8, default='en')
    is_verified_contributor = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)

    # Privacy: whether GET /api/users/{id}/'s own dedicated profile page shows anything beyond a
    # bare display name — basic attribution (a comment/review byline, an author name anywhere in
    # the app) is NEVER gated by this, since hiding who wrote a public comment would break the
    # comment itself, not just a profile page; this only controls the EXTRA info a visit to
    # /users/{id} specifically surfaces (joined date, role badges). See UserPublicView/
    # PublicProfileSerializer (accounts/views.py / serializers.py).
    show_profile_publicly = models.BooleanField(default=True)

    # Notification preferences — each one gates a real category of notifications/services.py's own
    # `notify()` call, not a decorative toggle: turning one off means that TYPE of Notification row
    # is never created for this user in the first place, not merely hidden client-side after the
    # fact. See notifications/services.py's `_PREFERENCE_FIELD_FOR_TYPE` for exactly which
    # notification types each field gates.
    notify_on_comment_reply = models.BooleanField(default=True)
    notify_on_moderation_decision = models.BooleanField(default=True)
    notify_on_content_action = models.BooleanField(default=True)

    # Finer-grained than the three coarse booleans above, layered on TOP of them rather than
    # replacing them: `notify()` only ever reaches this check once the notification's own coarse
    # category is already on, so muting a category still mutes everything under it regardless of
    # this list — this is a way to peel off ONE specific type from an otherwise-active category (e.g.
    # `translation_rejected` specifically, without losing every other `notify_on_moderation_decision`
    # alert), not a way to un-mute something the coarse toggle already turned off. A plain list of
    # `Notification.type` strings rather than N more boolean columns — genuinely open-ended (a future
    # notification type needs no new migration to become individually mutable) and there's no need to
    # query/filter on this field, only ever a membership check inside Python. `new_tagged_content` is
    # deliberately NOT gated by any of the three coarse fields (see notifications/services.py's own
    # note on why — that type's real gate is each TagFollow's own per-tag `notify` flag) but CAN
    # still appear in this list, as an account-wide "never notify me about new tagged content at
    # all" override that layers on top of, not instead of, the per-tag choice.
    muted_notification_types = models.JSONField(default=list, blank=True)

    # Tutoring ("Korepetycje") — a deliberately lightweight, opt-in signal, distinct from a real
    # services.Service listing (services/models.py): this is "I'm open to being asked," shown as a
    # badge on the public profile with a short free-text note, with NO structured course tie-in and
    # no rate — a user can set just this, or go further and create one or more real, course-scoped
    # Service listings, or both. The user's own explicit call ("let user set that personally") is why
    # both exist side by side rather than the app forcing one shape.
    offers_tutoring = models.BooleanField(default=False)
    tutoring_note = models.CharField(max_length=200, blank=True)

    def __str__(self) -> str:
        return self.display_name or self.user.username


# A curated preset list (payment methods + "buy me a coffee"-style services named explicitly, plus
# a generic 'other' catch-all for anything not covered) — lets the frontend render a recognizable
# icon/name per platform instead of parsing free text, while `label` still allows a custom override
# (e.g. "Ko-fi — monthly supporters only") or a fully custom name when platform='other'.
DONATION_PLATFORM_CHOICES = [
    ('paypal', 'PayPal'),
    ('payu', 'PayU'),
    ('blik', 'BLIK'),
    ('card', 'Card payment'),
    ('apple_pay', 'Apple Pay'),
    ('google_pay', 'Google Pay'),
    ('buy_me_a_coffee', 'Buy Me a Coffee'),
    ('ko_fi', 'Ko-fi'),
    ('patreon', 'Patreon'),
    ('github_sponsors', 'GitHub Sponsors'),
    ('bank_transfer', 'Bank transfer'),
    ('other', 'Other'),
]


class DonationLink(models.Model):
    """One of possibly several ways to support a contributor — "users can set multiple donation
    links that [a visitor] can choose from," not a single fixed URL — covering both real payment
    rails (PayU/BLIK/PayPal/card/Apple Pay/Google Pay) and "buy me a coffee"-style tip services, per
    the explicit request. Deliberately shown on the public profile regardless of
    `Profile.show_profile_publicly`, unlike joined_at/role badges above: that flag is about
    withholding IDENTITY/activity info a visitor didn't ask this account to publish; a donation link
    is the opposite — something the account holder actively chose to add specifically so it WOULD be
    shown. A profile with `show_profile_publicly=False` and zero donation links simply has none to
    show; adding one is itself the opt-in.
    """

    profile = models.ForeignKey(Profile, related_name='donation_links', on_delete=models.CASCADE)
    platform = models.CharField(max_length=20, choices=DONATION_PLATFORM_CHOICES, default='other')
    # Optional — blank means "use the platform's own display name" (get_platform_display()); set
    # when a user wants to distinguish two links on the same platform (e.g. two separate PayPal
    # links) or fully name a platform='other' link.
    label = models.CharField(max_length=100, blank=True)
    url = models.URLField()
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return f'{self.label or self.get_platform_display()} ({self.profile})'
