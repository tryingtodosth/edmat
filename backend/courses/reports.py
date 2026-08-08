"""Reported content that lives inside a user-run course, and who may act on it.

**The gap this closes, and the one it deliberately does not.** A comment reported inside somebody's
course could only ever be acted on by a global `is_staff` moderator. The people who actually run the
room — who already approve its contributions, remove its participants and lock its weeks — had no
way to deal with a reported comment in their own discussion. That is the missing capability.

**Node governors are deliberately NOT given this**, even though the obvious mechanical route exists:
a `Course` carries a `field` (Discipline) and `subjects` (Branches), so a report inside one could be
resolved to a governable taxonomy node and handed to whoever governs it. That was rejected. A
governor's remit is the shared corpus under their node — exercises, materials, translations, all of
it public by construction. A user-run course is somebody's room, and its discussion is not corpus:
resolving through a subject tag would hand a stranger moderation authority inside private study
groups they were never part of, which is precisely what `Course.visibility` exists to prevent. Global
staff keep access everywhere, exactly as before.

So the axis here is membership of the course's staff, not the taxonomy — which is why this lives in
`courses/` rather than being another branch of `moderation`'s own scoping engine.
"""

from django.contrib.contenttypes.models import ContentType

from community.models import Comment

from .models import Attachment, Chapter, Course, Lesson

#: The things inside a course that a comment can hang off. A reported comment is the only reportable
#: object in here today — `REPORT_KIND_MODELS` has no entry for a Course, Lesson, Chapter or
#: Attachment, so none of those can be reported directly, only discussed.
_COMMENTABLE = (Course, Chapter, Lesson, Attachment)


def course_of_commented_target(target) -> Course | None:
    """Which course a comment's target belongs to, or None if it belongs to none.

    Each of the four resolves differently, and a `Lesson` needs two hops — its chapter's course. A
    plain isinstance ladder rather than a registry: there are four, they are all in this module's own
    app, and a registry would be indirection over something a reader can check by eye.
    """
    if isinstance(target, Course):
        return target
    if isinstance(target, Chapter):
        return target.course
    if isinstance(target, Lesson):
        return target.chapter.course
    if isinstance(target, Attachment):
        return target.course
    return None


def course_of_reported(target) -> Course | None:
    """The course a reported object sits inside, or None.

    Only a `Comment` can be reported inside a course, so this is a single hop through the comment's
    own generic target. Written as its own function anyway, because `Report` is generic and a future
    reportable course object would be added here rather than at each call site.
    """
    if not isinstance(target, Comment):
        return None
    return course_of_commented_target(target.target)


def may_moderate_in_course(user, target) -> bool:
    """Whether this person may act on a report because of who they are to the course it is in.

    Deliberately narrow: it answers only the course question and returns False for everything else,
    so a caller ORs it with the global-staff and node-governor checks rather than this having to know
    about either.
    """
    course = course_of_reported(target)
    if course is None:
        return False
    return course.can_curate(user)


def pending_reports_in_course(course) -> list[dict]:
    """Every pending report on a comment inside this course, grouped by the comment reported.

    Grouped, not listed raw, for the same reason the platform queue groups: three people reporting
    one comment is one decision to make, and three rows would invite three clicks that each undo the
    others' work.

    Deliberately its own small query rather than a call into `build_report_queue`. That function is a
    heavily bulk-optimised builder scoped by taxonomy branch, and it computes a viewer-pool
    percentage from `ContentView` — which does not exist for anything in a course, so every row it
    produced here would carry a meaningless 0%. What a course's staff need is narrower and honest:
    what was said, by whom, where, how many people objected and why.
    """
    from moderation.models import Report

    comment_ct = ContentType.objects.get_for_model(Comment)

    # Which comments live in this course: the ids of its own commentable objects, per content type.
    ids_by_type: dict[int, set[int]] = {}
    for model, ids in (
        (Course, [course.pk]),
        (Chapter, list(course.chapters.values_list('pk', flat=True))),
        (Lesson, list(Lesson.objects.filter(chapter__course=course).values_list('pk', flat=True))),
        (Attachment, list(course.attachments.values_list('pk', flat=True))),
    ):
        if ids:
            ids_by_type[ContentType.objects.get_for_model(model).id] = set(ids)

    inside = [
        comment
        for comment in Comment.objects.filter(
            content_type_id__in=ids_by_type.keys()
        ).select_related('author__profile')
        if comment.object_id in ids_by_type.get(comment.content_type_id, ())
    ]
    if not inside:
        return []

    by_pk = {comment.pk: comment for comment in inside}
    rows: dict[int, dict] = {}
    for report in (
        Report.objects.filter(
            content_type=comment_ct, object_id__in=by_pk.keys(), status='pending'
        )
        .select_related('reported_by__profile')
        .order_by('-created_at')
    ):
        comment = by_pk[report.object_id]
        row = rows.setdefault(
            comment.pk,
            {
                'kind': 'comment',
                'id': comment.pk,
                'body': comment.body,
                'author': _display_name(comment.author),
                'where': _where(comment),
                'auto_hidden': comment.auto_hidden_at is not None,
                'is_removed': comment.is_removed,
                'report_count': 0,
                'reasons': [],
                'last_reported_at': report.created_at,
            },
        )
        row['report_count'] += 1
        if report.reason:
            row['reasons'].append(report.reason)
        # Reports arrive newest-first, so the first one seen for a comment is the most recent.
        row['last_reported_at'] = max(row['last_reported_at'], report.created_at)

    # Already-hidden first — it is hidden RIGHT NOW and waiting on somebody, which is more urgent
    # than something merely complained about. Then by how many people objected. Same priority order
    # the platform queue uses, so a moderator reading both is not switching conventions.
    return sorted(
        rows.values(),
        key=lambda row: (not row['auto_hidden'], -row['report_count'], row['id']),
    )


def _display_name(user) -> str:
    profile = getattr(user, 'profile', None)
    return profile.display_name if profile and profile.display_name else user.username


def _where(comment) -> str:
    """A human answer to "which conversation was this in", so staff are not made to guess from an id."""
    target = comment.target
    if isinstance(target, Course):
        return target.title
    if isinstance(target, Chapter):
        return target.title
    if isinstance(target, Lesson):
        return f'{target.chapter.title} — {target.title}'
    if isinstance(target, Attachment):
        return target.title
    return ''
