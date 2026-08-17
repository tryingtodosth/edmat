"""Naming the thing a `Comment` is attached to, in the one vocabulary both halves already speak.

A `Comment` reaches its target through a `GenericForeignKey`, so the row itself only knows a
`ContentType` — an integer that means nothing to a client. The frontend has always known the target
by a short name instead (`CommentTargetType` in `src/lib/types/comment.ts`: `'exercise'`,
`'materialCoverage'`, `'courseLesson'`, …), and until now it never had to be told which one it was
looking at: every thread is fetched through an endpoint that already says so
(`/api/exercises/{id}/comments/`), so the caller passes the name down and the response never carries
it.

Linking a thread into a course breaks that, and this module is why it exists: a course item points
at a comment by id alone, and the reader has to be sent somewhere to read it. Only the server can
answer which page that is.

Deliberately a hand-written map rather than the model name lowercased. Three of these do not match
(`courses.Course` is `taughtCourse` — this app's own model is not the taxonomy's), and a convention
that silently produced the wrong string for the one case where a mismatch is likeliest would be
worse than a table somebody has to add a line to. The frontend's own union is the other half of
this pair, and neither can be derived from the other, so both are flagged in each other's comments.
"""

from django.contrib.contenttypes.models import ContentType

# (app_label, model) -> the name the frontend knows this target by.
TARGET_TYPE_BY_MODEL = {
    ('exercises', 'exercise'): 'exercise',
    ('materials', 'material'): 'material',
    ('materials', 'materialcoverage'): 'materialCoverage',
    ('materials', 'materialreview'): 'materialReview',
    ('services', 'service'): 'service',
    ('services', 'servicereview'): 'serviceReview',
    ('courses', 'course'): 'taughtCourse',
    ('courses', 'lesson'): 'courseLesson',
    ('courses', 'chapter'): 'courseChapter',
    ('community', 'review'): 'review',
}

# The targets whose own threads are NOT public: a course's discussion, and a week's or a session's
# inside it, are readable by its participants (see `Course.discussion_mode`, which defaults to
# `participants` precisely because the roster is private). Everything else in the map above hangs off
# a page anybody can open.
#
# Kept here rather than in `courses/` because it is a fact about comment targets, and the code that
# needs it is the code that has just resolved one — see `CourseItemWriteSerializer`, which refuses to
# link somebody else's private thread into a course for the same reason it refuses another course's
# attachment.
PRIVATE_TARGET_TYPES = {'taughtCourse', 'courseLesson', 'courseChapter'}


def target_type_for(comment) -> str:
    """The short name for this comment's target, or `''` for one this map has never been taught.

    Empty rather than an exception: a thread hanging off something added later is a gap in this
    table, not a corrupt row, and a reader should lose the link to it rather than the page around it.
    """
    ct = ContentType.objects.get_for_id(comment.content_type_id)
    return TARGET_TYPE_BY_MODEL.get((ct.app_label, ct.model), '')
