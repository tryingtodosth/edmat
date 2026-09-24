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
    ('courses', 'courseclaim'): 'courseClaim',
    ('exercises', 'exerciseclaim'): 'exerciseClaim',
    ('exercises', 'solutionentry'): 'solutionEntry',
    ('community', 'review'): 'review',
    ('issues', 'issue'): 'issue',
    ('activity', 'post'): 'post',
    ('events', 'session'): 'eventSession',
    # The review thread on one proposed/published version of a material (coauthoring/). Named
    # `materialVersion` and not `version`, for the same reason `taughtCourse` is not `course`: the
    # frontend's union is a flat namespace across the whole platform, and a bare "version" would
    # be the first name in it that does not say what it is a version OF.
    ('coauthoring', 'materialversion'): 'materialVersion',
    # The cooperation thread of one material's project (materials_coop/): where the team, and
    # under an `open` policy anybody weighing a proposal, talk about the work rather than about
    # one version of it. Hangs off the PROJECT so it survives every version.
    ('coauthoring', 'materialproject'): 'materialProject',
    # The talk about one article of a concept (concepts/). Named for the ARTICLE and not the
    # concept, because that is what the thread hangs off: a concept has as many articles as people
    # have written, and one thread across all of them would mix a conversation about the
    # primary-school wording with one about the university proof.
    ('concepts', 'conceptarticle'): 'conceptArticle',
}

# The targets whose own threads are NOT public: a course's discussion, and a week's or a session's
# inside it, are readable by its participants (see `Course.discussion_mode`, which defaults to
# `participants` precisely because the roster is private). Everything else in the map above hangs off
# a page anybody can open.
#
# `materialVersion` is here for the same reason and a slightly different one: a version's thread is
# a REVIEW thread, and most versions are not public at all. A draft is visible to the project's
# team, a proposal to its author and the people who may decide it, a rejected one to the same
# circle — only `published`/`superseded` rows are readable by anybody (`coauthoring.access
# .can_view_version`). A set that said "public" for the two visible statuses and "private" for the
# four others would be a per-ROW answer, and this is a per-TYPE table; the honest per-type answer
# for a thread that is usually private is private, which costs a published version's thread the
# ability to be linked into a course and costs nothing else.
#
# Kept here rather than in `courses/` because it is a fact about comment targets, and the code that
# needs it is the code that has just resolved one — see `CourseItemWriteSerializer`, which refuses to
# link somebody else's private thread into a course for the same reason it refuses another course's
# attachment.
# `conceptArticle` is deliberately NOT below: an article a reader can see is a page anybody can
# open (`concepts.access.can_view_article` admits it only once it has a published revision), which
# is exactly the test this per-type table applies. A course may therefore link a concept's thread
# in, which is the ordinary and wanted case.
PRIVATE_TARGET_TYPES = {
    'taughtCourse',
    'courseLesson',
    'courseChapter',
    'eventSession',
    'materialVersion',
    # Readable wherever the project is, but a `request`/`closed` team's room is not a public
    # thread a course should link in.
    'materialProject',
}


def target_type_for(comment) -> str:
    """The short name for this comment's target, or `''` for one this map has never been taught.

    Empty rather than an exception: a thread hanging off something added later is a gap in this
    table, not a corrupt row, and a reader should lose the link to it rather than the page around it.
    """
    ct = ContentType.objects.get_for_id(comment.content_type_id)
    return TARGET_TYPE_BY_MODEL.get((ct.app_label, ct.model), '')
