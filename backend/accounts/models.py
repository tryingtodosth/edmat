"""CLAUDE.md Section 9: "Django's built-in auth.User plus a Profile ... no need to reinvent auth."

A Profile row is created automatically for every User via a post_save signal (see apps.py), so every
call site that reads request.user.profile can assume it exists rather than defensively creating it.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

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

    # How dates and times are DRAWN — the calendar views, and every clock this app prints. Real
    # stored preferences rather than whatever the interface language happens to imply, because the
    # two are genuinely independent: plenty of people read the English interface and still expect
    # 16:00, and `Intl`'s own per-locale default hands an English reader "4:00 PM" whether they
    # wanted it or not. That WAS the behaviour before these fields existed, and it was nobody's
    # choice.
    #
    # 24-hour and Monday are the defaults deliberately. Both are what this app's own markets (Poland,
    # Ukraine, the EU generally) use, and both are what the rest of the stack already speaks —
    # `AvailabilityRule` stores a 24-hour `TimeField` and numbers weekdays from Monday, matching
    # Python's own `date.weekday()` — so the default costs no conversion anywhere. The other two are
    # a real setting rather than an inference, because guessing them from a locale is how somebody
    # ends up looking at the wrong one with no way to say so.
    TIME_FORMAT_CHOICES = [('24h', '24-hour'), ('12h', '12-hour (AM/PM)')]
    time_format = models.CharField(max_length=3, choices=TIME_FORMAT_CHOICES, default='24h')

    # Stored as a name rather than as `Date.getDay()`'s 0/1: a row stays readable, and the frontend's
    # own numbering convention stays the frontend's business rather than being baked into the column.
    WEEK_START_CHOICES = [('monday', 'Monday'), ('sunday', 'Sunday')]
    week_starts_on = models.CharField(max_length=8, choices=WEEK_START_CHOICES, default='monday')

    # Where the "add to a course" half of the save menu sits relative to the list of sets. Two
    # answers, both defensible, and which one reads better genuinely depends on the screen and on
    # whether somebody files things into courses often or almost never — so it is a setting rather
    # than a decision made once for everybody.
    #
    # `beside` is the default because filing an exercise into a course is the rarer of the two jobs:
    # it keeps the sets, which is what most people came for, on the direct path.
    SAVE_MENU_LAYOUT_CHOICES = [
        ('beside', 'Courses beside the sets'),
        ('above', 'Courses above the sets'),
    ]
    save_menu_layout = models.CharField(
        max_length=8, choices=SAVE_MENU_LAYOUT_CHOICES, default='beside'
    )

    # A short self-description. Always public when set — like `display_name`, it is something the
    # account holder actively wrote to be read, so `show_profile_publicly` (which withholds info a
    # visitor never chose to publish, e.g. the joined date) does not gate it.
    bio = models.TextField(max_length=1000, blank=True)
    is_verified_contributor = models.BooleanField(default=False)
    # How many courses this account may own in total. Counted over every course it owns rather than
    # only the unfinished ones: "you have 3 of your 5" is a sentence somebody can act on, whereas a
    # cap that silently frees a slot when a course is marked finished is one people would discover
    # by accident. 0 means uncapped — the same convention
    # `Course.capacity` and `Course.upload_quota_bytes` already use, so "no limit" reads
    # the same everywhere it appears.
    #
    # Uncapped by default, and lowered per account by an administrator in Django admin rather than
    # earned automatically. The tier ladder on /levels describes a system that would set this from
    # reputation; none of that is built, and defaulting everyone to a number nothing can yet raise
    # would cap real people on the strength of a design note.
    max_courses = models.PositiveSmallIntegerField(default=0)

    # How many bytes of uploaded MATERIAL this account may hold on the server at once — the
    # per-person counterpart to `TaughtCourse.upload_quota_bytes`, which caps one course.
    #
    # The two do not overlap, and the gap between them is why this exists. That one is enforced on
    # the course-content path alone (`TaughtCourseViewSet.items`, classroom/views.py); the main
    # upload route, `POST /api/material-submissions/`, never consulted it and had no aggregate limit
    # of its own at all, so one account was bounded only by the 25MB per-file cap
    # (`MAX_MATERIAL_SUBMISSION_SIZE_BYTES`) times however many requests it cared to make. On a
    # university box with a shared filesystem that is the whole disk, one account at a time.
    #
    # 0 means uncapped, the same convention `max_courses` above and `TaughtCourse.capacity`/
    # `.upload_quota_bytes` already use, so "no limit" reads identically everywhere it appears. And
    # uncapped is the DEFAULT, deliberately: nobody's existing behaviour changes until an
    # administrator picks a number in Django admin. The reasoning is the one `max_courses` gives
    # just above and the `material_uploads_verified_only` flag's own migration (moderation/0011)
    # states for a differently-shaped restriction — provisioning a limit must never quietly narrow
    # somebody's access on the strength of its mere existence, and there is no reputation system
    # built that could raise a number set on everybody's behalf.
    material_upload_quota_bytes = models.PositiveBigIntegerField(default=0)

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
    # Courses run by users (classroom/). One coarse category covering all six course notification
    # types — somebody who does not want course traffic does not want any of it, and the per-type
    # mute list below already gives finer control than a second boolean would.
    notify_on_course_activity = models.BooleanField(default=True)
    # Booking a session with a tutor (booking/). One coarse category, for the same reason course
    # activity has one: a booking's four events are two people having one conversation, and somebody
    # who wants none of it wants none of it. Worth more thought before switching off than the others,
    # though — a tutor who mutes this stops hearing that anybody has asked for an hour of their time,
    # which the Settings copy says out loud rather than leaving to be discovered.
    notify_on_booking = models.BooleanField(default=True)
    # Events (events/). Its own switch rather than a share of `notify_on_course_activity`, because
    # the two describe different things to the person reading the label — and because the volume is
    # different in kind: a course announces every lesson, where an event only ever speaks when
    # somebody joins it, when it moves, or when it is called off. All three are things you would want
    # to hear about even having muted a great deal else, which is why this defaults on.
    notify_on_event = models.BooleanField(default=True)

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

    @property
    def material_upload_bytes(self) -> int:
        """Total bytes this account currently occupies with material submissions.

        Summed live from storage rather than kept as a running total on the row — deliberately the
        same shape as `TaughtCourse.uploaded_bytes` (classroom/models.py) rather than a second
        answer to the same question, and for the same reason, which is worth restating because the
        obvious objection ("that is one `stat()` per submission") is real:

        A stored counter has to stay correct after every upload, every rejection that reclaims a
        file, every upload that failed validation halfway, and every deletion an administrator makes
        in Django admin. Each of those is a place it can drift, and a drifted counter is invisible:
        it either refuses uploads that would have fitted or admits ones that do not, with nothing on
        the row to say which. A live sum cannot be wrong about what is actually on disk, and what is
        actually on disk is the only thing a byte quota is trying to bound.

        The cost is bounded by where this is read: once per upload request (alongside a malware scan
        that is orders of magnitude more expensive) and on the Django admin changelist. Neither is
        hot, and one account's submissions number in the tens — keeping that true is the point of
        the quota. If this ever does become hot, the first move is a `file_size` column written at
        upload time plus a single `Sum()` aggregate, which is still derived from real rows and so
        still cannot drift, unlike a counter kept here.

        **Every submission counts, whatever its status, and that is a decision rather than a
        shortcut.** An approved one still counts because its bytes are still on disk — the published
        `Material` points at the very same stored path (`_apply_material_submission` copies the
        reference, never the file) — and exempting approved uploads would leave the cap bounding
        nothing at all over a long enough membership. A rejected one whose blob has been reclaimed
        needs no status filter to stop counting: it has no file left, so it contributes zero on its
        own. The quota measures disk, not decisions.
        """
        # Imported here rather than at module scope so the model-import graph stays one-way:
        # `moderation` already imports `materials`, which imports `taxonomy`, and nothing in that
        # chain imports `accounts` — keeping this app a leaf is cheaper than reasoning about a cycle
        # every time somebody adds an import over there.
        from moderation.models import MaterialSubmission

        total = 0
        for submission in MaterialSubmission.objects.filter(submitted_by=self.user).only('file'):
            stored = submission.file
            if not stored:
                continue
            try:
                total += stored.size
            except (OSError, ValueError):
                # A row whose file is missing from storage must not take an upload (or the admin
                # changelist) down with it; it occupies nothing, which is the honest reading of
                # "not there" — the same handling `TaughtCourse.uploaded_bytes` already gives it.
                continue
        return total

    @property
    def material_upload_bytes_left(self) -> int | None:
        """None when uncapped — deliberately not 0, which would read as "full", the same distinction
        `TaughtCourse.upload_bytes_left`/`seats_left` already draw for their own limits."""
        if not self.material_upload_quota_bytes:
            return None
        return max(self.material_upload_quota_bytes - self.material_upload_bytes, 0)

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


# What somebody has DONE and what they are GOOD AT — two separate lists, because they answer two
# different questions and mix badly in one. An experience entry is a period with a place attached;
# a skill is a claim about a subject, and the interesting thing about it is what backs the claim.
EXPERIENCE_KIND_CHOICES = [
    ('study', 'Studies'),
    ('work', 'Work'),
    ('teaching', 'Teaching'),
    ('project', 'Project'),
    ('other', 'Other'),
]


class ExperienceEntry(models.Model):
    """One line of somebody's history, as they choose to describe it.

    Entirely self-declared and shown as such — nothing here is verified, and it is not pretending to
    be. That is a different thing from `identity.EducationProfile`, where a claim is backed by an
    institution's own registry; the two sit next to each other on a profile precisely so the
    difference is visible.
    """

    profile = models.ForeignKey(Profile, related_name='experience', on_delete=models.CASCADE)
    kind = models.CharField(max_length=12, choices=EXPERIENCE_KIND_CHOICES, default='other')
    title = models.CharField(max_length=200)
    organisation = models.CharField(max_length=200, blank=True)
    started_on = models.DateField(null=True, blank=True)
    # Null means ongoing, which is genuinely different from an unknown end date — the UI says
    # "present" rather than leaving a dash somebody has to interpret.
    ended_on = models.DateField(null=True, blank=True)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        # Most recent first, with an explicit `order` available for somebody who wants to override
        # that on their own profile. Nulls (ongoing) sort to the top, which is where they belong.
        ordering = ['order', '-started_on', 'id']

    def __str__(self) -> str:
        return f'{self.title} ({self.profile})'


SKILL_LEVEL_CHOICES = [
    ('learning', 'Learning'),
    ('comfortable', 'Comfortable'),
    ('teaching', 'Could teach it'),
]

# What actually backs the claim — the whole point of the field. A skill anybody can type is worth
# what typing costs; one the university's own registry attested is not, and a reader deserves to be
# able to tell them apart at a glance rather than being asked to trust a flat list.
SKILL_EVIDENCE_CHOICES = [
    ('self_declared', 'Self-declared'),
    ('coursework', 'Passed the course here'),
    ('registry', 'Confirmed by the university registry'),
]


class SkillEntry(models.Model):
    profile = models.ForeignKey(Profile, related_name='skills', on_delete=models.CASCADE)
    label = models.CharField(max_length=100)
    level = models.CharField(max_length=12, choices=SKILL_LEVEL_CHOICES, default='comfortable')
    evidence = models.CharField(
        max_length=16, choices=SKILL_EVIDENCE_CHOICES, default='self_declared'
    )
    # Optional links into the real taxonomy — what makes a skill more than a word. A skill tied to a
    # Branch can be counted, filtered and matched against the exercises on this site; a free-text one
    # cannot, which is why both are allowed but only one of them is useful to the rest of the app.
    # This is also where `identity.standing.skill_seeds` would land once USOS grades are imported for
    # real: the seeds already compute exactly this shape.
    branch = models.ForeignKey(
        'taxonomy.Branch', null=True, blank=True, related_name='claimed_skills', on_delete=models.SET_NULL
    )
    discipline = models.ForeignKey(
        'taxonomy.Discipline', null=True, blank=True, related_name='claimed_skills', on_delete=models.SET_NULL
    )
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'label']
        constraints = [
            models.UniqueConstraint(
                fields=['profile', 'label'], name='unique_skill_label_per_profile'
            )
        ]

    def __str__(self) -> str:
        return f'{self.label} ({self.profile})'


class Certificate(models.Model):
    """A credential somebody was issued by somebody else — a language exam, an online course, a
    training certificate.

    **It is a third kind of claim, which is the whole reason it is not folded into either neighbour.**
    `ExperienceEntry` is a period the account holder describes in their own words, and nobody else was
    involved. `identity.Diploma` came out of an institution's own registry, so this site read it
    rather than being told it. A certificate sits between the two: a real third party issued it, and
    the only thing this site has is the holder's word that they did. Merging it upward into `Diploma`
    would quietly borrow the registry's authority for something typed into a box; merging it down into
    `ExperienceEntry` would throw away the one field that makes it checkable, which is the link.

    **There is deliberately no file upload here**, and that is a decision rather than a scope cut. An
    uploaded scan is not evidence — anybody can upload any image, so a reader who trusts the PDF is
    trusting exactly the same thing they were already trusting (the holder), while the site takes on a
    binary-upload path, storage, and a moderation surface for pictures nobody can verify anyway. A
    `url` pointing at the issuer's own verification page is the opposite: it is checkable by the
    reader in one click, and worthless to fake. Same reasoning `Material.source_url` already records —
    "provenance nobody can follow is worse than none".

    `expires_on = NULL` means it does not expire, which is genuinely different from a date in the
    past; `is_expired` answers that once, server-side, so the public profile and the owner's own
    editor cannot disagree about it.
    """

    profile = models.ForeignKey(Profile, related_name='certificates', on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    #: Who issued it. Free text rather than a FK to `identity.School`: most of these come from
    #: bodies this site has never heard of (Cambridge Assessment, a MOOC platform, a training
    #: company), and a picker limited to the 23 seeded universities would fit almost none of them.
    issuer = models.CharField(max_length=200, blank=True)
    issued_on = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    #: The issuer's own reference for it, printed on the certificate. Shown next to `url`, because
    #: plenty of verification pages ask for the id rather than embedding it in a link.
    credential_id = models.CharField(max_length=120, blank=True)
    url = models.URLField(blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        # Newest first within the person's own chosen order, matching `ExperienceEntry` exactly. A
        # certificate with no issue date sorts to the top, which is where an unfinished row belongs
        # while somebody is still filling it in.
        ordering = ['order', '-issued_on', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['profile', 'title', 'issuer'],
                name='unique_certificate_per_profile',
            )
        ]

    @property
    def is_expired(self) -> bool:
        if self.expires_on is None:
            return False
        return self.expires_on < timezone.localdate()

    def __str__(self) -> str:
        return f'{self.title} ({self.profile})'
