"""A recipient-scoped activity feed for the moderation/community events EdMat already has real
triggers for — see notifications/services.py's `notify()` for the one place every one of these rows
gets created, and moderation/views.py + exercises/views.py + materials/views.py for the call sites.

Deliberately denormalized (`target_label`, `exercise`), not a GenericForeignKey the way Comment/
Report resolve their own target — a Notification.exercise is nullable and SET_NULL on delete
specifically so an exercise being later removed doesn't cascade-delete someone's own notification
history, and `target_label` is captured once at creation time rather than re-resolved on every read
(the same "carry a label, avoid a lookup" reasoning this project's own sibling `2donet` blueprint
already documents for its own Notification.targetLabel). A submission that gets REJECTED never
becomes a real Exercise at all, so `exercise` genuinely has to be optional, not just defensively so.

No grouping/clustering of same-type notifications into one card (unlike `2donet`'s own
NotificationGroup) — EdMat's real event volume per user is small enough (a handful of moderation
decisions, occasional replies) that a plain reverse-chronological list is honest and sufficient;
building a clustering layer for volume this app doesn't actually have yet would be speculative, not
grounded.
"""

from django.conf import settings
from django.db import models

NOTIFICATION_TYPES = [
    ('submission_approved', 'Exercise submission approved'),
    ('submission_rejected', 'Exercise submission rejected'),
    ('edit_suggestion_approved', 'Edit suggestion approved'),
    ('edit_suggestion_rejected', 'Edit suggestion rejected'),
    ('translation_approved', 'Translation approved'),
    ('translation_rejected', 'Translation rejected'),
    ('comment_reply', 'Reply to your comment'),
    ('content_auto_hidden', 'Content auto-hidden by community reports'),
    ('content_restored', 'Content restored by a moderator'),
    ('content_removed', 'Content removed by a moderator'),
    # A followed tag (exercises.TagFollow) got attached to new/existing content — see
    # notifications/services.py's notify_tag_followers. The one type here whose recipient is a
    # FOLLOWER, not a participant in the event itself (everything above notifies someone about their
    # OWN content/decision; this notifies someone who merely subscribed to a tag).
    ('new_tagged_content', 'New content tagged with a tag you follow'),
    # Courses run by users (classroom/). Six types rather than one 'course_activity', because they
    # are genuinely different events with different recipients — an instructor gets the request, the
    # applicant gets the answer — and a single type would leave the UI unable to say which happened
    # without parsing a label. They share one coarse preference category, which is where "I do not
    # want any of this" belongs.
    ('course_enrollment_requested', 'Somebody asked to join your course'),
    ('course_enrollment_approved', 'You were let into a course'),
    ('course_enrollment_declined', 'Your request to join was declined'),
    ('course_removed', 'You were removed from a course'),
    ('course_new_lesson', 'A new lesson in a course you are taking'),
    ('course_new_post', 'A new post in a course discussion'),
    # Contributions and staffing, added with the course overhaul. Same reasoning as above: the
    # recipients differ (staff get the submission, the contributor gets the answer), so collapsing
    # them would leave the UI unable to say what happened.
    ('course_contribution_submitted', 'Somebody offered content to a course you run'),
    ('course_contribution_approved', 'Your contribution was accepted'),
    ('course_contribution_rejected', 'Your contribution was not accepted'),
    ('course_staff_added', 'You were made a member of a course team'),
    ('course_invite_used', 'Somebody used your invite link'),
    # Booking a session with a tutor (booking/). Four types, split by recipient the same way the
    # course ones are: the tutor gets the request, the student gets the answer, and either can be the
    # one told about a cancellation. `booking_cancelled` deliberately has no direction in its name
    # because it genuinely goes both ways — `Booking.cancelled_by` is what says which, and the note
    # carries the session's own time, so one type is enough.
    ('booking_requested', 'Somebody asked to book a session with you'),
    ('booking_confirmed', 'Your booking was confirmed'),
    ('booking_declined', 'Your booking request was declined'),
    ('booking_cancelled', 'A booking was cancelled'),
    # One-off events (events/). A host is told when somebody says they are coming, and everybody
    # holding a seat is told when the event moves, is called off, or the host posts an update. A
    # decline is deliberately NOT a type — see events/services.py for why telling a host about every
    # "no" would make hosting a well-attended event unpleasant.
    ('event_attendance', 'Somebody is coming to your event'),
    ('event_updated', 'An event you are going to has changed'),
    ('event_cancelled', 'An event you were going to was called off'),
    # Kept separate from `event_updated` even though both mean "something about this event changed",
    # because the two ask different things of the reader. `event_updated` fires when the time or the
    # place moved — the reader must go and rearrange their evening. This fires when the host wrote
    # something — the reader should go and read it. Collapsing them would make the urgent one
    # indistinguishable from "the slides are up", which is how people learn to ignore both.
    ('event_posted', 'A new update on an event you are going to'),
]


class Notification(models.Model):
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='notifications', on_delete=models.CASCADE
    )
    # None for a system-triggered event (community auto-hide has no single acting user) — every
    # other type always has one (the moderator who decided, or the person who replied).
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    type = models.CharField(max_length=32, choices=NOTIFICATION_TYPES)
    target_label = models.CharField(max_length=300, blank=True)
    exercise = models.ForeignKey(
        'exercises.Exercise', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # Added alongside 'new_tagged_content' — a followed tag can be attached to a Material, which has
    # no Exercise to link through. Same nullable/SET_NULL shape as `exercise` above, same reasoning.
    material = models.ForeignKey(
        'materials.Material', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # Same nullable/SET_NULL shape and the same reason as `material` above: a course notification has
    # neither an Exercise nor a Material to link through, and a notification you cannot click is
    # markedly less useful than one you can.
    course = models.ForeignKey(
        'courses.Course', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # Same nullable/SET_NULL shape and the same reason as `course` above: an event
    # notification has none of the three targets above to link through, and a notification you
    # cannot click is markedly less useful than one you can.
    event = models.ForeignKey(
        'events.Event', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # A moderator's own review_note/resolved_note, or a comment reply's own short preview — whatever
    # extra context that event type actually has, blank when it doesn't.
    note = models.TextField(blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.type} -> {self.recipient}'
