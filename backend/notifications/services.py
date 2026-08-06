"""`notify()` — the one place every Notification row in this app gets created, called from
moderation/views.py (submission/edit/translation decisions, report restore/remove),
moderation/services.py (community auto-hide), and exercises/views.py + materials/views.py (a comment
reply). Callers never construct a Notification directly, so the recipient=None guard, the
self-notification guard, and the privacy-preference check below can never be bypassed by a new call
site forgetting one of them.
"""

from __future__ import annotations

from config.i18n_utils import DEFAULT_FALLBACK_LOCALE

# Which Profile boolean (accounts/models.py) gates each notification type — a recipient who has
# turned a category off simply never gets a row created for it, not just a row they'd have to
# manually hide. Every type not listed here (there are none today, but a future addition landing
# here unlisted is a real possibility) defaults to "always notify" in `notify()` below, matching
# this project's own "never let a new field silently do nothing" instinct — a missing entry means
# no preference gates it, not that it fails closed.
_PREFERENCE_FIELD_FOR_TYPE = {
    'comment_reply': 'notify_on_comment_reply',
    'submission_approved': 'notify_on_moderation_decision',
    'submission_rejected': 'notify_on_moderation_decision',
    'material_submission_approved': 'notify_on_moderation_decision',
    'material_submission_rejected': 'notify_on_moderation_decision',
    'edit_suggestion_approved': 'notify_on_moderation_decision',
    'edit_suggestion_rejected': 'notify_on_moderation_decision',
    'translation_approved': 'notify_on_moderation_decision',
    'translation_rejected': 'notify_on_moderation_decision',
    'content_auto_hidden': 'notify_on_content_action',
    'content_restored': 'notify_on_content_action',
    'content_removed': 'notify_on_content_action',
    # All six course types share one coarse category: somebody who does not want course traffic does
    # not want any of it, and the per-type mute list already exists for finer control than that.
    'course_enrollment_requested': 'notify_on_course_activity',
    'course_enrollment_approved': 'notify_on_course_activity',
    'course_enrollment_declined': 'notify_on_course_activity',
    'course_removed': 'notify_on_course_activity',
    'course_new_lesson': 'notify_on_course_activity',
    'course_new_post': 'notify_on_course_activity',
    # These five were valid `Notification.type` choices but had no entry here, so `notify()` fell
    # through to its "no preference gates it" default and sent them regardless — a setting labelled
    # "courses" that five course notifications ignored. They belong to the same category as the six
    # above: somebody who does not want course traffic does not want to hear that a contribution
    # arrived either.
    'course_contribution_submitted': 'notify_on_course_activity',
    'course_contribution_approved': 'notify_on_course_activity',
    'course_contribution_rejected': 'notify_on_course_activity',
    'course_staff_added': 'notify_on_course_activity',
    'course_invite_used': 'notify_on_course_activity',
    # Booking (booking/). One coarse category for all four, on the course types' own reasoning — see
    # Profile.notify_on_booking for why this is the one worth thinking twice about before muting.
    'booking_requested': 'notify_on_booking',
    'booking_confirmed': 'notify_on_booking',
    'booking_declined': 'notify_on_booking',
    'booking_cancelled': 'notify_on_booking',
    # Events (events/). Their own coarse category rather than riding on `notify_on_course_activity`:
    # a category called "course activity" that silently also governs events would be a setting whose
    # label lies, and somebody who runs no courses but goes to talks would have to guess which switch
    # theirs is under.
    'event_attendance': 'notify_on_event',
    'event_updated': 'notify_on_event',
    'event_cancelled': 'notify_on_event',
    'event_posted': 'notify_on_event',
    # Taxonomy proposals (taxonomy/). Under the existing moderation-decision category rather than a
    # new one: somebody proposed a word, a moderator decided on it, and that is the same kind of
    # event as a decision on a submitted exercise — a separate switch would be splitting hairs the
    # setting's own label ("moderation decisions") does not split.
    #
    # Four types, not one with the outcome in the text, because the reader's next move differs.
    # Approved and rejected are finished; merged and moved both say "the things you filed under this
    # are somewhere else now, here is where", which is the one taxonomy decision worth acting on.
    'taxonomy_approved': 'notify_on_moderation_decision',
    'taxonomy_merged': 'notify_on_moderation_decision',
    'taxonomy_moved': 'notify_on_moderation_decision',
    'taxonomy_rejected': 'notify_on_moderation_decision',
}

# The full catalog of real notification types, each paired with the coarse category (Profile
# boolean field name) it falls under — `None` for `new_tagged_content`, which has no coarse
# category at all (see that type's own note, below and in `notify_tag_followers`). Built FROM
# `_PREFERENCE_FIELD_FOR_TYPE` above rather than a second, hand-maintained list that could drift
# out of sync with it — this is the one place a new call site (or a new frontend toggle) should
# read from to know every real type that exists, not re-derive its own copy. `NotificationPreferenceView`
# (views.py) is what actually hands this to the frontend, so the per-type mute list in Settings
# never needs its own hardcoded catalog either.
NOTIFICATION_TYPES: list[tuple[str, str | None]] = [
    *_PREFERENCE_FIELD_FOR_TYPE.items(),
    ('new_tagged_content', None),
]


def label_for_exercise(exercise) -> str:
    """The same per-locale-resolved title moderation/services.py's `_describe` already computes for
    the moderator-facing queue — reused here so a notification's own `target_label` reads the exact
    same title a moderator saw when they made the decision, not a second, possibly-differently-
    resolved copy."""
    if exercise is None:
        return ''
    from exercises.serializers import _resolve_exercise_translation

    translation = _resolve_exercise_translation(exercise, DEFAULT_FALLBACK_LOCALE)
    return translation.title if translation else f'#{exercise.number}'


def notify(
    recipient,
    notif_type: str,
    *,
    actor=None,
    target_label: str = '',
    exercise=None,
    material=None,
    course=None,
    event=None,
    note: str = '',
):
    """Creates one Notification, or silently no-ops when there's genuinely nothing to notify:
    - `recipient` is None — the real, common case for legacy/migrated content with no real owner
      (Exercise.submitted_by is null for every one of the 742 imported exercises), or a translation
      whose `translated_by` is null (also the migrated original). Not an error condition; every
      call site already expects this to be silently swallowed rather than needing its own check.
    - `actor == recipient` — a moderator should never get a notification for their own decision
      (can't actually happen given who's allowed to submit vs. moderate today, but cheap to guard
      regardless of whether the two roles ever overlap for one account).
    - the recipient has turned this notification's whole CATEGORY off in their own privacy settings
      (accounts/models.py's Profile.notify_on_* fields) — see `_PREFERENCE_FIELD_FOR_TYPE` above.
      Deliberately NOT consulted for `new_tagged_content` — that type's own coarse-category gating
      happens one level up instead, in `notify_tag_followers`, via each follower's own `TagFollow
      .notify` flag, a per-TAG choice rather than a blanket account-wide category the way every
      other type's gating is.
    - the recipient has muted this SPECIFIC type individually (`Profile.muted_notification_types`),
      even though its own coarse category is still otherwise on — checked second, after the coarse
      category, so muting the whole category still mutes everything under it regardless of this
      list; this only ever peels off ONE type from an otherwise-active category, never the reverse.
    """
    if recipient is None:
        return None
    if actor is not None and actor.pk == recipient.pk:
        return None

    profile = getattr(recipient, 'profile', None)

    preference_field = _PREFERENCE_FIELD_FOR_TYPE.get(notif_type)
    if preference_field is not None:
        if profile is not None and not getattr(profile, preference_field, True):
            return None

    if profile is not None and notif_type in (profile.muted_notification_types or []):
        return None

    from .models import Notification

    return Notification.objects.create(
        recipient=recipient,
        actor=actor,
        type=notif_type,
        target_label=target_label,
        exercise=exercise,
        material=material,
        course=course,
        event=event,
        note=(note or '')[:500],
    )


def label_for_material(material) -> str:
    """Same "resolve the real, per-locale title" reasoning as `label_for_exercise` above, for a
    Material's own MaterialTranslation table instead of ExerciseTranslation."""
    if material is None:
        return ''
    translation = material.translations.filter(locale=DEFAULT_FALLBACK_LOCALE).first() or material.translations.first()
    return translation.title if translation else material.slug


def label_for_taxonomy_node(node) -> str:
    """A discipline/branch/topic's own name, same resolve-then-fall-back-to-the-slug shape as the two
    helpers above. Read at decision time rather than at render time because merge and reject both
    delete the node — by the time anybody opens the notification there is nothing left to name."""
    if node is None:
        return ''
    translation = (
        node.translations.filter(locale=DEFAULT_FALLBACK_LOCALE).first() or node.translations.first()
    )
    return translation.name if translation else node.slug


def notify_tag_followers(tag, *, actor, exercise=None, material=None):
    """Called right after a Tag gets attached to a piece of content — both the moderation-approved-
    submission path (moderation/views.py's `_apply_submission`, a brand-new Exercise) and the
    "add to different content" tag-hover action (exercises/views.py's `TagViewSet.apply`, an
    EXISTING Exercise or Material gaining a tag it didn't have before). Notifies every follower of
    this tag who has `notify=True` on their own `TagFollow` row — deliberately NOT gated by
    `notify()`'s own account-level `_PREFERENCE_FIELD_FOR_TYPE` (see that function's own note): the
    per-tag `notify` flag IS the gate here, checked in this loop, before `notify()` is ever called —
    a follower who muted this one tag never even reaches `notify()`'s own (irrelevant, for this
    type) account-level check.

    A follower's own account-wide `muted_notification_types` (accounts/models.py) is STILL checked
    here, though, one layer above the per-tag flag — this is the "mute new_tagged_content entirely"
    override the per-type preference UI (Settings) offers, for someone who wants to keep following
    tags (Save For Later, Add To Content still work regardless) without ever being notified about
    any of them, rather than having to mute `notify` on every individual `TagFollow` row by hand.
    """
    label = label_for_exercise(exercise) if exercise is not None else label_for_material(material)
    from .models import Notification

    for follow in tag.follows.filter(notify=True).select_related('user', 'user__profile'):
        if follow.user_id == getattr(actor, 'pk', None):
            continue  # notify()'s own actor==recipient guard would catch this too, checked here to avoid the query overhead of building a Notification just to discard it
        profile = getattr(follow.user, 'profile', None)
        if profile is not None and 'new_tagged_content' in (profile.muted_notification_types or []):
            continue
        Notification.objects.create(
            recipient=follow.user,
            actor=actor,
            type='new_tagged_content',
            target_label=label,
            exercise=exercise,
            material=material,
            note=f'#{tag.slug}',
        )


def notify_comment_reply(
    comment, *, target_label: str, exercise=None, material=None, root_recipient=None
):
    """Called right after a new Comment is saved — the one shared implementation for
    exercises/views.py's `ExerciseViewSet.comments`, materials/views.py's
    `MaterialCoverageViewSet.comments`/`MaterialViewSet.comments`, and services/views.py's
    `ServiceViewSet.comments`, since "was this a reply, and if so tell the parent's author" is the
    same question regardless of what the thread is attached to. `material` (new) lets a whole-
    material discussion reply carry a real, clickable link the way an exercise reply already does
    (`notify()`'s own `material=` param, unchanged) — a per-coverage-claim reply still passes
    neither (there's no natural single Material/Exercise page for a specific coverage row to link
    to any more precisely than the material's own detail page, and `_notify_coverage_reply` was
    never asked to add that link, so it's left exactly as before).

    `root_recipient` is what a review thread needs and no other thread does. Everywhere else a
    top-level comment genuinely has nobody to notify — it is the opening line of a discussion
    attached to an exercise or a material, which nobody personally wrote. A comment under somebody's
    REVIEW is the opposite: the top-level one is precisely the reply being made to a person, and
    they are the one who should hear about it. Callers that have such a person pass them; the
    others pass nothing and keep the old behaviour exactly.

    Replying to your own earlier comment — or to your own review — is handled by `notify()`'s own
    actor==recipient guard, not duplicated here."""
    recipient = comment.parent.author if comment.parent_id else root_recipient
    if recipient is None:
        return None
    return notify(
        recipient,
        'comment_reply',
        actor=comment.author,
        target_label=target_label,
        exercise=exercise,
        material=material,
        note=comment.body[:200],
    )


def notify_course_participants(
    course, notif_type: str, *, actor=None, note: str = '', include_instructor: bool = False
):
    """Tell everybody taking part in a course that something happened in it.

    Three independent gates, and they are deliberately checked at three different levels, because
    they answer three different questions:

    * the **course's own setting** — the instructor decided whether this kind of event is announced
      at all (a course that posts a lesson a day should be able to stop announcing each one);
    * each **participant's per-course mute** (`Enrollment.notify`) — the same shape `TagFollow.notify`
      already uses, so somebody can stay in a busy course without hearing about every post;
    * each person's **account-wide preference**, which `notify()` applies on its own.

    Only active participants are notified. Somebody with a pending request has not joined, and
    telling them what is happening inside would leak exactly what the participants-only rule exists
    to protect.
    """
    from courses.models import ACTIVE_ENROLLMENT_STATUSES

    recipients = []
    for enrollment in course.enrollments.filter(
        status__in=ACTIVE_ENROLLMENT_STATUSES, notify=True
    ).select_related('participant'):
        recipients.append(enrollment.participant)
    if include_instructor:
        recipients.append(course.instructor)

    created = []
    for recipient in recipients:
        result = notify(
            recipient,
            notif_type,
            actor=actor,
            target_label=course.title,
            course=course,
            note=note,
        )
        if result is not None:
            created.append(result)
    return created
