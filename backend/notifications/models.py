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
    # Both were really sent (moderation/views.py) and both were gated correctly, but neither was
    # ever a valid choice here — so the admin showed a bare value and `get_type_display()` answered
    # with the raw string. The two catalogs in this app drift in both directions; this is that drift
    # the other way round from the five course types services.py was missing.
    #
    # **Nothing sends these two any more** and they stay anyway: `MaterialSubmission` was folded
    # into a co-authored project (`coauthoring/0003_fold_material_submissions`) and a decision on a
    # material now sends `material_version_decided`. Existing rows in real inboxes still carry the
    # old types, and a type nobody can look up is exactly the bare-value bug the comment above
    # records — so removing them would break the history this table is for.
    ('material_submission_approved', 'Material upload approved'),
    ('material_submission_rejected', 'Material upload rejected'),
    ('solution_entry_approved', 'Solution/hint accepted'),
    ('solution_entry_rejected', 'Solution/hint declined'),
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
    ('session_changed', 'A session on your agenda moved'),
    ('registration_confirmed', 'Your registration was confirmed'),
    ('registration_waitlisted', 'You are on the waiting list'),
    ('registration_promoted', 'A seat is yours — confirm it'),
    ('registration_declined', 'Your registration was declined'),
    ('contribution_submitted', 'Somebody proposed a contribution to your event'),
    ('contribution_decided', 'Your proposal was decided'),
    # Taxonomy proposals (taxonomy/). Four rather than one with the outcome in the text, because the
    # reader's next move differs: approved and rejected are finished, while merged and moved both
    # mean "whatever you filed under this is somewhere else now", and the note says where.
    ('taxonomy_approved', 'Your suggested discipline, branch or topic was added'),
    ('taxonomy_merged', 'Your suggestion already existed and was merged'),
    ('taxonomy_moved', 'Your suggestion was moved somewhere else in the taxonomy'),
    ('taxonomy_rejected', 'Your suggestion was not added'),
    # Site issue reports (issues/): staff moved a report the recipient filed under their name.
    ('issue_status_changed', 'Your issue report changed status'),
    # DSA Art. 16 legal notices (legal/): staff decided a notice the recipient filed. Kept separate
    # from `issue_status_changed` even though the shape is identical — the two are legally distinct
    # obligations (Art. 16(6) vs. this app's own bug-report courtesy), and `legal.LegalNotice` is
    # deliberately not `issues.Issue` at all (see legal/models.py).
    ('legal_notice_decided', 'A legal notice you filed was decided'),
    # Applying to look after a discipline, a branch or one material (moderation.GovernorApplication).
    # Two types rather than one, because the recipients are different people with different next
    # moves: the applicant is told what was decided, and staff are told there is something waiting —
    # a queue nobody is told about is a queue that stalls, which is the same reasoning the course
    # contribution queue already records for notifying every member of staff rather than one.
    ('governor_application_submitted', 'Somebody applied to look after content'),
    ('governor_application_decided', 'Your application to look after content was decided'),
    # Co-authoring a material (coauthoring/, COAUTHORING-BRIEF.md §4). Seven rather than one
    # 'project_activity', on the same reasoning the six course types already record: the recipients
    # are different people with different next moves. A proposal reaches the team, who must decide
    # it; the decision reaches the proposer, who wanted to know if their work was taken; a
    # publication reaches the other co-authors, who now have a new head to work from. Collapsing
    # them would leave the card unable to say which of the three happened without parsing a label.
    #
    # They split across two existing coarse categories rather than adding an eighth Profile
    # boolean (notifications/services.py's `_PREFERENCE_FIELD_FOR_TYPE`): the two "somebody decided
    # on the thing I sent" types belong under moderation decisions, and the rest are ordinary
    # activity on content the recipient is involved with.
    ('material_version_proposed', 'Somebody proposed a new version'),
    ('material_version_decided', 'Your proposed version was decided'),
    ('material_version_published', 'A new version of a material you co-author'),
    ('project_invite_used', 'Somebody used your project invite link'),
    ('project_member_added', 'You were added to a material project'),
    ('project_join_requested', 'Somebody asked to join a project you co-author'),
    ('project_join_decided', 'Your request to join a project was decided'),
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
    # Same shape again, for an issue report — the page it opens is the report itself.
    # An anchored micro-post (activity.Post) — same shape and reasoning as `event` before it: a
    # reply notification a reader cannot click is markedly less useful than one they can.
    post = models.ForeignKey(
        'activity.Post', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    issue = models.ForeignKey(
        'issues.Issue', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # A co-authoring project, for the notifications that happen BEFORE there is a material to link
    # to — a first version proposed on a draft project, an invite used, somebody asking to join.
    # Same nullable/SET_NULL shape and the same reason as every FK above it: a notification you
    # cannot click is markedly less useful than one you can, and this app's own model only earns an
    # FK here because it has a real page of its own (`/material-projects/[id]`).
    #
    # Once the project publishes, its notifications carry `material` instead — that is the page a
    # reader actually wants, and `coauthoring.services._link_kwargs` is the one place that chooses.
    material_project = models.ForeignKey(
        'coauthoring.MaterialProject',
        null=True,
        blank=True,
        related_name='+',
        on_delete=models.SET_NULL,
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
