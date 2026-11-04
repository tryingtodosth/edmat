from django.utils.text import Truncator
from rest_framework import serializers

from community.targets import PRIVATE_TARGET_TYPES, target_type_for
from config.i18n_utils import request_locale, resolve_translation
from taxonomy.models import Branch, Discipline

from .attachmentfile import process_attachment_file
from .rules import (
    ancestors_of,
    course_visible_to,
    item_licence_relation,
    item_target_licence,
    item_visibility_block_reason,
    relation_to_parent,
    subcourse_block_reason,
)
from .models import (
    ACTIVE_ENROLLMENT_STATUSES,
    DEFAULT_COURSE_KIND,
    LISTED_VISIBILITIES,
    MIN_PEERS_FOR_ANONYMOUS_COUNTS,
    PROGRESS_NOT_STARTED,
    Attachment,
    AttachmentReview,
    Chapter,
    ChapterReview,
    LessonReview,
    CourseCompletion,
    CourseInvite,
    CourseItem,
    CourseNote,
    CourseStaff,
    Enrollment,
    Lesson,
    LessonExerciseSet,
    LessonSetExercise,
    Course,
)


class ParticipantSerializer(serializers.Serializer):
    """Just enough to name a person, matching what every other author byline in this API exposes.

    Deliberately not the full profile: a participant list is a list of who is in the room, and
    resolving each one's whole profile inline would both bloat the response and leak more than the
    question asked for. A client that wants more calls `/api/users/{id}/`, which already applies
    that person's own privacy settings.
    """

    id = serializers.IntegerField(source='pk', read_only=True)
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, user) -> str:
        profile = getattr(user, 'profile', None)
        return (profile.display_name if profile and profile.display_name else user.username)


def is_participant_of(course, user) -> bool:
    """Whether this viewer is "in the room" for the participant-only lesson notes.

    Module-level so the viewset's own chapter endpoints share the one definition with
    `CourseSerializer` rather than growing a third copy that can disagree with the other two.
    """
    if user is None or not getattr(user, 'is_authenticated', False):
        return False
    if course.is_staff_member(user):
        return True
    return course.enrollments.filter(
        participant=user, status__in=ACTIVE_ENROLLMENT_STATUSES
    ).exists()


class LessonSetExerciseSerializer(serializers.ModelSerializer):
    """One pinned exercise, named the way every other exercise reference in this API is.

    An exercise has never had a title in this project — it is identified by its subject and number,
    which is exactly what `Exercise.__str__` composes, so this reuses it rather than inventing a
    second naming scheme, exactly as `CourseItemSerializer.get_label` already does.
    """

    label = serializers.SerializerMethodField()
    published = serializers.BooleanField(source='exercise.published', read_only=True)

    class Meta:
        model = LessonSetExercise
        fields = ['id', 'exercise', 'label', 'order', 'published']

    def get_label(self, row) -> str:
        return str(row.exercise)


class LessonExerciseSetSerializer(serializers.ModelSerializer):
    exercises = serializers.SerializerMethodField()
    linked_by = ParticipantSerializer(read_only=True)
    # The source's own slug, or null once it has been deleted or the viewer cannot read it. A link
    # whose source is gone keeps working — that is the point of pinning — so this is genuinely
    # optional rather than an error state.
    source_slug = serializers.SerializerMethodField()
    source_exists = serializers.SerializerMethodField()
    has_drifted = serializers.SerializerMethodField()
    hidden_exercise_count = serializers.SerializerMethodField()

    class Meta:
        model = LessonExerciseSet
        fields = [
            'id',
            'lesson',
            'chapter',
            'title',
            'note',
            'order',
            'exercises',
            'linked_by',
            'linked_at',
            'refreshed_at',
            'source_slug',
            'source_exists',
            'has_drifted',
            'hidden_exercise_count',
            # Who may see the whole block — the item ladder (2026-11-02).
            'visibility',
        ]

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def _can_curate(self, link) -> bool:
        """Asked once per course per response, not once per field per row.

        DRF reuses ONE child serializer across every row under `many=True`, so caching on `self`
        would be a real bug here — this project has already been bitten by exactly that. The cache
        lives in the request-scoped context and is keyed by course, so two links can never read each
        other's answer.
        """
        cache = self.context.setdefault('_lesson_set_curate_cache', {})
        course = link.course
        if course.pk not in cache:
            cache[course.pk] = course.can_curate(self._user())
        return cache[course.pk]

    def get_exercises(self, link):
        """Filtered per viewer: an unpublished exercise is dropped for anybody who cannot curate.

        `CourseItem.is_visible_to` does not make the equivalent check on its own referenced object;
        this deliberately does — see `LessonExerciseSet.visible_exercises`.
        """
        return LessonSetExerciseSerializer(
            link.visible_exercises(self._user(), can_curate=self._can_curate(link)),
            many=True,
            context=self.context,
        ).data

    def get_hidden_exercise_count(self, link) -> int:
        """How many pinned exercises this viewer is NOT being shown, because a moderator pulled
        them. Stated as a number rather than silently swallowed, so a shorter list is explained."""
        shown = link.visible_exercises(self._user(), can_curate=self._can_curate(link))
        return len(link.exercises.all()) - len(shown)

    def get_source_slug(self, link) -> str | None:
        return link.exercise_set.slug if link.exercise_set_id else None

    def get_source_exists(self, link) -> bool:
        return bool(link.exercise_set_id)

    def get_has_drifted(self, link) -> bool:
        """Whether the source set now holds a different list than what was pinned — curators only.

        Anybody else has nothing to do with the answer: they cannot re-copy, and the source is
        somebody else's private list. False for a source that is gone, or one this viewer may not
        read, because "drifted" is not a claim that can be made about a set nobody can see.
        """
        source = link.exercise_set
        if source is None or not self._can_curate(link):
            return False
        pinned = [row.exercise_id for row in link.exercises.all()]
        current = list(
            source.exercisesetitem_set.order_by('order', 'id').values_list('exercise_id', flat=True)
        )
        return pinned != current


def rating_summary(reviews) -> dict:
    """{count, average} for a set of reviews, read off `.all()` so a prefetch is honoured.

    Reading `.all()` rather than calling `.aggregate()` is deliberate: an aggregate always issues
    its own query, which on a course detail page is one per lesson plus one per chapter — the exact
    N+1 shape the moderation queue was measured making. Off a prefetched cache this costs nothing.
    """
    ratings = [review.rating for review in reviews.all()]
    if not ratings:
        return {'count': 0, 'average': None}
    return {'count': len(ratings), 'average': round(sum(ratings) / len(ratings), 2)}


def active_participants(course) -> dict:
    """{user_id: user} for everybody currently on the roster.

    Built once per course and handed to every lesson rather than recomputed per lesson: the roster is
    a fact about the course, and a twelve-week course would otherwise ask the same question thirty
    times to draw thirty progress bars. Reads `enrollments.all()` so the viewset's existing prefetch
    serves it.
    """
    return {
        enrollment.participant_id: enrollment.participant
        for enrollment in course.enrollments.all()
        if enrollment.status in ACTIVE_ENROLLMENT_STATUSES
    }


def lesson_progress_payload(lesson, course, viewer, *, roster=None, school_mode=None) -> dict:
    """What this viewer may know about how far people have got on this lesson.

    Always the same shape, whatever the mode and whoever is asking — `mine`, `summary` and `people`
    go null rather than disappearing, so a client branches on a value it can read instead of on
    whether a key exists. That is the same reasoning `get_participant_notes` blanks rather than
    omits, and it is what lets the UI say *why* it is showing nothing.

    The four gates are `Course`'s, not re-derived here: this function decides what to put in the
    envelope, and the course decides who is allowed each part of it.

    **School mode is the one widening** (`courses/rules.py`). In a course an organisation of kind
    `school` runs, somebody who may curate it reads every participant's statements by name whatever
    `progress_visibility` says — a teacher who cannot see whether a twelve-year-old did the reading
    is not running a class. It widens nothing for a participant, and it does not make `off` writable:
    `can_record` is still `Course.progress_writable_by`, so a pupil in a class with tracking off has
    nothing to press, and the panel then shows the teacher a roster of `not_started` rows, which is
    the truthful thing to show. `school_mode` is passed in already resolved (one organisations query
    per response rather than one per lesson) and recomputed only when a caller does not say.
    """
    from . import rules

    mode = course.progress_visibility
    if school_mode is None:
        school_mode = rules.staff_sees_all_progress(viewer, course)
    payload = {
        'mode': mode,
        'mine': None,
        'can_record': course.progress_writable_by(viewer),
        # Said out loud rather than left for the client to infer from "the names are here although
        # the mode says anonymous": the panel has a line explaining WHY a teacher is seeing this,
        # which is also what tells them their pupils know (the course page says so to everybody).
        'school_mode': bool(school_mode),
        'summary': None,
        'people': None,
        'withheld_reason': None,
    }

    # `off`, or somebody who is not in the course at all. Note this covers staff under `off` too:
    # rows still exist in the database and none of them are described here.
    if not (school_mode or course.progress_visible_to(viewer)):
        return payload

    viewer_id = getattr(viewer, 'pk', None)
    rows = list(lesson.progress.all())
    for row in rows:
        if row.participant_id == viewer_id:
            payload['mine'] = row.status
            break

    if not (school_mode or course.progress_peers_visible_to(viewer)):
        return payload

    if roster is None:
        roster = active_participants(course)
    named = bool(school_mode) or course.progress_names_visible_to(viewer)

    if not named and len(roster) - (1 if viewer_id in roster else 0) < MIN_PEERS_FOR_ANONYMOUS_COUNTS:
        # Anonymity that a count gives away is not anonymity. Say so rather than showing an empty
        # panel, which reads as "nobody has done anything" — the opposite of the truth.
        payload['withheld_reason'] = 'small_cohort'
        return payload

    # Only rows belonging to people still on the roster. Somebody who left is not part of "3 of 6
    # have finished" — they are not one of the 6 — and counting their row would let the numerator
    # exceed the denominator, which is the shape of bug nobody reports because it just looks wrong.
    counted = [row for row in rows if row.participant_id in roster]
    by_status = {'in_progress': 0, 'stuck': 0, 'done': 0}
    for row in counted:
        if row.status in by_status:
            by_status[row.status] += 1
    payload['summary'] = {
        **by_status,
        'not_started': len(roster) - len(counted),
        'participants': len(roster),
    }

    if named:
        said = {row.participant_id: row for row in counted}
        people = []
        for user_id, user in roster.items():
            row = said.get(user_id)
            people.append(
                {
                    'participant': ParticipantSerializer(user).data,
                    # Everybody on the roster, including the people who have said nothing — "who has
                    # not started" is most of what makes this list worth reading, and a list of only
                    # the people who answered would quietly be a different question.
                    'status': row.status if row else PROGRESS_NOT_STARTED,
                    'updated_at': row.updated_at if row else None,
                }
            )
        people.sort(key=lambda entry: entry['participant']['display_name'].lower())
        payload['people'] = people

    return payload


class LessonSerializer(serializers.ModelSerializer):
    participant_notes = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()
    exercise_sets = serializers.SerializerMethodField()
    reviews = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = [
            'id',
            'chapter',
            'title',
            'description',
            'order',
            'scheduled_at',
            'duration_minutes',
            'participant_notes',
            'items',
            'exercise_sets',
            'reviews',
            'progress',
        ]

    def get_progress(self, lesson) -> dict:
        """How far people have got, as much of it as this viewer is allowed.

        `course`, `progress_roster` and `school_mode` come through the context because all three are
        facts about the course rather than the lesson: reading `lesson.chapter.course` here would be
        a query per lesson for a row the caller already had in its hand, and resolving school mode
        here would be an organisations query per session on a twelve-week course.
        """
        request = self.context.get('request')
        course = self.context.get('course') or lesson.chapter.course
        return lesson_progress_payload(
            lesson,
            course,
            getattr(request, 'user', None),
            roster=self.context.get('progress_roster'),
            school_mode=self.context.get('school_mode'),
        )

    def get_reviews(self, lesson) -> dict:
        """The summary only — count and average. The reviews themselves are their own endpoint,
        because a course with twelve weeks of sessions would otherwise serialize every rating
        anybody ever left on any of them just to draw one page."""
        return rating_summary(lesson.reviews)

    def get_exercise_sets(self, lesson):
        """Filtered by each link's own `is_visible_to`, not by the caller having already checked.

        That matters here specifically: `CourseSerializer.get_lessons` returns every lesson flat,
        with no chapter-lock filter of its own, so a locked chapter's lessons DO reach this
        serializer by that route. Asking each link the question itself is what keeps this field
        correct on both paths rather than only on the nested one.
        """
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        visible = [link for link in lesson.exercise_sets.all() if link.is_visible_to(user)]
        return LessonExerciseSetSerializer(visible, many=True, context=self.context).data

    def get_items(self, lesson):
        """Filtered per viewer, not per lesson: a pending contribution is visible to staff and to
        whoever offered it, and to nobody else. The chapter's own lock is already applied one level
        up, in `ChapterSerializer.get_lessons`."""
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        visible = [item for item in lesson.items.all() if item.is_visible_to(user)]
        return CourseItemSerializer(visible, many=True, context=self.context).data

    def get_participant_notes(self, lesson) -> str:
        """Blank for anybody who is not actually in the course.

        Enforced here rather than by omitting the field for outsiders, so the shape of the response
        does not change with the caller — a client never has to branch on whether a key exists, only
        on whether it is empty.
        """
        return lesson.participant_notes if self.context.get('is_participant') else ''


class LessonWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lesson
        fields = [
            'chapter',
            'title',
            'description',
            'order',
            'scheduled_at',
            'duration_minutes',
            'participant_notes',
        ]


class CourseSerializer(serializers.ModelSerializer):
    instructor = ParticipantSerializer(read_only=True)
    subject_slugs = serializers.SlugRelatedField(
        source='subjects', slug_field='slug', many=True, read_only=True
    )
    field_slug = serializers.SlugRelatedField(source='field', slug_field='slug', read_only=True)
    lessons = serializers.SerializerMethodField()
    participant_count = serializers.IntegerField(source='active_participant_count', read_only=True)
    seats_left = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)
    # The viewer's own relationship to this course, resolved server-side. The client should never
    # have to work out "am I in this?" by scanning a participant list it may not even be allowed to
    # see.
    my_enrollment_status = serializers.SerializerMethodField()
    can_enrol = serializers.SerializerMethodField()
    enrollment_block_reason = serializers.SerializerMethodField()
    is_instructor = serializers.SerializerMethodField()
    # Resolved server-side for the same reason `can_enrol` is: whether this viewer may read or post
    # in the thread depends on the course's mode AND their membership, and a client working that out
    # for itself is a client that can get it wrong.
    can_read_discussion = serializers.SerializerMethodField()
    can_post_discussion = serializers.SerializerMethodField()
    notify_me = serializers.SerializerMethodField()
    # The viewer's own standing, resolved server-side for the same reason `can_enrol` is: the client
    # should never work out from a roster what it is allowed to do, because a client that computes a
    # permission is a client that can compute it wrongly.
    my_role = serializers.SerializerMethodField()
    can_administer = serializers.SerializerMethodField()
    can_curate = serializers.SerializerMethodField()
    can_contribute = serializers.SerializerMethodField()
    contribution_needs_approval = serializers.SerializerMethodField()
    # The organisation of kind `school` that runs this course, if there is one — what makes the
    # course a *class* (`courses/rules.py`). A thin summary rather than the whole organisation: the
    # page draws a name and a link, and `/api/organizations/{id}/` is where more belongs. Null for
    # every ordinary course, which is almost all of them; the "run by <organisation>" line is a
    # different and wider question (ANY `runs` link, any kind of body) and is read from
    # `/api/nodes/course/{id}/organizations/`, which `organizations` already owns.
    school = serializers.SerializerMethodField()
    # The general course this is a university/faculty version of (`rules.py`), as `{id, title}` —
    # or null when there is none OR the viewer cannot see it. A participant of a version can be in
    # a course whose general parent has since gone private; they keep their course and are not
    # told the title of one they may no longer read.
    parent_summary = serializers.SerializerMethodField()
    # `'version'` | `'subcourse'` | null — what this course IS to its parent, read from the two rows
    # by `rules.relation_to_parent` (never stored). The course page draws its two lists from it.
    parent_relation = serializers.SerializerMethodField()
    # The chain above this course, root first, as `{id, title, kind}` — the breadcrumb on the
    # page. Cut at the first ancestor the viewer cannot see, from the top: a reader inside a
    # subcourse whose grandparent went private is shown the trail from the first course they may
    # open, and is not told the title of one they may not.
    ancestors = serializers.SerializerMethodField()
    chapters = serializers.SerializerMethodField()
    unfiled_items = serializers.SerializerMethodField()
    pending_contribution_count = serializers.SerializerMethodField()

    class Meta:
        model = Course
        fields = [
            'id',
            'instructor',
            'title',
            'summary',
            'description',
            'subject_slugs',
            'field_slug',
            'kind',
            'parent',
            'parent_summary',
            'parent_relation',
            'ancestors',
            'university',
            'faculty',
            'course_code',
            'current_term',
            'visibility',
            # What is written in the course is under this; linked items keep their own.
            'licence',
            'status',
            # Read-only here on purpose: the quota is an administrator's cost control, set in Django
            # admin, not something a course's own instructor may raise for themselves. Both are sent
            # so the UI can say "180 MB of 500 MB" rather than only refusing an upload at the point
            # somebody has already chosen the file.
            'upload_quota_bytes',
            'uploaded_bytes',
            'enrollment_policy',
            'capacity',
            'discussion_mode',
            'announce_new_lessons',
            'announce_new_posts',
            'progress_visibility',
            'language',
            'starts_on',
            'ends_on',
            'price',
            'currency',
            'created_at',
            'lessons',
            'participant_count',
            'seats_left',
            'is_full',
            'my_enrollment_status',
            'can_enrol',
            'enrollment_block_reason',
            'is_instructor',
            'can_read_discussion',
            'can_post_discussion',
            'notify_me',
            'contribution_policy',
            'my_role',
            'can_administer',
            'can_curate',
            'can_contribute',
            'contribution_needs_approval',
            'school',
            'chapters',
            'unfiled_items',
            'pending_contribution_count',
        ]

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def _my_enrollment(self, course):
        user = self._user()
        if not user or not user.is_authenticated:
            return None
        # Uses the prefetched rows when the view supplied them, so a list of 50 courses does not
        # become 50 extra queries.
        for enrollment in course.enrollments.all():
            if enrollment.participant_id == user.pk:
                return enrollment
        return None

    def _is_participant(self, course) -> bool:
        """Whether this viewer is "in the room", and so may read the participant-only lesson notes.

        One definition, used by both the flat `lessons` list and the nested chapter -> lesson one.
        It used to live only in `get_lessons`, so the nested copy — which is the shape the course
        page actually renders — passed a context with no `is_participant` in it at all and blanked
        every lesson's notes for everybody, including the staff who wrote them.
        """
        enrollment = self._my_enrollment(course)
        # "In the room" includes every member of staff, not only the owner — an assistant who cannot
        # read the lesson notes they are supposed to be teaching from is not an assistant.
        return bool(
            (enrollment and enrollment.status in ACTIVE_ENROLLMENT_STATUSES)
            or course.is_staff_member(self._user())
        )

    def get_lessons(self, course):
        """Every lesson the reader may actually see, flat.

        The chapter filter is the whole point and was missing: this field used to return every
        lesson in the course regardless of its chapter's lock, which meant `participant_notes` for a
        week that had not opened yet went over the wire to any participant. Invisible in the UI —
        the frontend renders `chapter.lessons` — and live to anything reading the API directly.
        `ChapterSerializer.get_lessons` has always been correct; this one is now too, and
        `LessonSerializer.get_items`' assumption that the lock was applied one level up finally
        holds on both paths rather than only the nested one.
        """
        user = getattr(self.context.get('request'), 'user', None)
        # Walks the course's own prefetched chapters rather than issuing a fresh `Lesson` query.
        # It used to do the latter, with a duplicate set of prefetches to match — which still cost a
        # query per lesson, because `select_related('chapter')` gives each lesson its OWN Course
        # instance, and a fresh Course has none of this queryset's prefetches: every
        # `is_visible_to` then re-read `CourseStaff` from scratch. Measured at six extra queries per
        # lesson before this, constant after.
        #
        # It is also the stronger fix: this list is now literally the same objects the nested
        # chapter -> lesson path serializes, so the two cannot disagree about what is visible — which
        # is exactly the bug that put participant-only notes for a locked week on the wire.
        lessons = [
            lesson
            for chapter in course.chapters.all()
            if chapter.is_visible_to(user)
            for lesson in chapter.lessons.all()
        ]
        return LessonSerializer(
            lessons, many=True, context=self._lesson_context(course)
        ).data

    def get_parent_summary(self, course):
        parent = course.parent
        if parent is None:
            return None
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if parent.visibility not in LISTED_VISIBILITIES and not course_visible_to(user, parent):
            return None
        return {'id': parent.pk, 'title': parent.title, 'kind': parent.kind}

    def get_parent_relation(self, course):
        return relation_to_parent(course)

    def get_ancestors(self, course):
        if course.parent_id is None:
            return []
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        rows = []
        for node in ancestors_of(course):
            visible = node.visibility in LISTED_VISIBILITIES or course_visible_to(user, node)
            if not visible:
                # Start the trail again below the one the viewer may not open.
                rows = []
                continue
            rows.append({'id': node.pk, 'title': node.title, 'kind': node.kind})
        return rows

    def get_my_enrollment_status(self, course) -> str | None:
        enrollment = self._my_enrollment(course)
        return enrollment.status if enrollment else None

    def get_is_instructor(self, course) -> bool:
        """Kept, and now true for every member of staff.

        The name is the pre-existing API contract and the frontend reads it in a dozen places; what
        it has always meant is "does this person run the course", which is exactly the question that
        now has three answers instead of one. `my_role` is there for anybody who needs the finer
        distinction.
        """
        return course.is_staff_member(self._user())

    def get_enrollment_block_reason(self, course) -> str | None:
        return course.enrollment_block_reason(self._user())

    def get_can_enrol(self, course) -> bool:
        return course.enrollment_block_reason(self._user()) is None

    def get_can_read_discussion(self, course) -> bool:
        return course.discussion_visible_to(self._user())

    def get_can_post_discussion(self, course) -> bool:
        return course.discussion_writable_by(self._user())

    def get_my_role(self, course) -> str | None:
        return course.role_of(self._user())

    def get_can_administer(self, course) -> bool:
        return course.can_administer(self._user())

    def get_can_curate(self, course) -> bool:
        return course.can_curate(self._user())

    def get_can_contribute(self, course) -> bool:
        return course.can_contribute(self._user())

    def get_contribution_needs_approval(self, course) -> bool:
        return course.contribution_needs_approval(self._user())

    def _schools_map(self) -> dict:
        """`{course_id: Organization}` for every class on the platform, resolved ONCE per request.

        Stashed on the serializer context, which DRF shares between a `ListSerializer` and all of
        its children, so a directory of fifty courses asks the organisations table once rather than
        fifty times. The honest limit is `rules.schools_running_courses`'s: the map is loaded whole.
        """
        cache = self.context.get('_schools_map')
        if cache is None:
            from . import rules

            cache = rules.schools_running_courses()
            self.context['_schools_map'] = cache
        return cache

    def _school(self, course):
        return self._schools_map().get(course.pk)

    def get_school(self, course) -> dict | None:
        school = self._school(course)
        if school is None:
            return None
        return {
            'id': str(school.pk),
            'name': school.name,
            'slug': school.slug,
            'kind': school.kind,
        }

    def _lesson_context(self, course) -> dict:
        """The extra context every lesson needs, resolved once per course.

        `is_participant` was already shared this way; `course`, `progress_roster` and `school_mode`
        join it for the same reason — all are per-course facts, and resolving them inside
        `LessonSerializer` would cost a query per session on a page that renders all of them.
        """
        from . import rules

        school = self._school(course)
        return {
            **self.context,
            'is_participant': self._is_participant(course),
            'course': course,
            'progress_roster': active_participants(course),
            'school_mode': rules.staff_sees_all_progress(self._user(), course, school=school),
        }

    def get_chapters(self, course):
        return ChapterSerializer(
            course.chapters.all(), many=True, context=self._lesson_context(course)
        ).data

    def get_unfiled_items(self, course):
        """Content in the course and filed nowhere — in no lesson AND in no chapter.

        Its own field rather than a nameless chapter, because "not filed yet" is a real state — it is
        where a participant's submission lands before anybody decides which week it belongs to, and a
        course that uses no chapters at all keeps everything here quite legitimately.

        BOTH targets have to be null. Testing only one draws every item filed the other way a second
        time, in the loose pile underneath the chapter it is already sitting in — which is what
        happened while this read `chapter_id is None` alone: a lesson's contents were also reported
        as unfiled, because a lesson-filed row genuinely has no chapter of its own.
        """
        user = self._user()
        visible = [
            item
            for item in course.items.all()
            if item.lesson_id is None and item.chapter_id is None and item.is_visible_to(user)
        ]
        return CourseItemSerializer(visible, many=True, context=self.context).data

    def get_pending_contribution_count(self, course) -> int:
        """Badge fodder for the staff review queue, and 0 for everybody else — a participant has no
        business knowing how much is queued in a course they merely attend."""
        if not course.can_curate(self._user()):
            return 0
        return sum(1 for item in course.items.all() if item.status == 'pending')

    def get_notify_me(self, course) -> bool | None:
        """The viewer's own per-course mute. None when they are not in the course at all, which is
        genuinely different from "in the course, notifications off"."""
        enrollment = self._my_enrollment(course)
        return enrollment.notify if enrollment else None


class CourseWriteSerializer(serializers.ModelSerializer):
    # Referred to by their slugs rather than their numeric pks, matching how the rest of this API
    # already addresses taxonomy rows (`Service.course_slugs`) — a client that has a course page
    # open knows its slug, not its id.
    subjects = serializers.SlugRelatedField(
        slug_field='slug', many=True, required=False, queryset=Branch.objects.all()
    )
    parent = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), required=False, allow_null=True
    )
    field = serializers.SlugRelatedField(
        slug_field='slug', required=False, allow_null=True, queryset=Discipline.objects.all()
    )

    class Meta:
        model = Course
        fields = [
            'title',
            'summary',
            'description',
            'subjects',
            'field',
            'kind',
            'parent',
            'university',
            'faculty',
            'course_code',
            'current_term',
            'visibility',
            'licence',
            'status',
            'enrollment_policy',
            'capacity',
            'discussion_mode',
            'announce_new_lessons',
            'announce_new_posts',
            'progress_visibility',
            'contribution_policy',
            'language',
            'starts_on',
            'ends_on',
            'price',
            'currency',
        ]

    def validate_licence(self, value):
        from licensing.licences import licence_validation_error

        reason = licence_validation_error(value)
        if reason:
            raise serializers.ValidationError(reason)
        return value

    def validate(self, attrs):
        # The course's licence is chosen HERE only when the course is created. Afterwards it only
        # widens, recorded, through `/api/licences/course/<id>/` (`licensing/rules.py`) — a PATCH
        # that could set it would be a way around "only wider, and every change a row". The same
        # value is let through silently, so a form that sends back what it was given still saves.
        if self.instance is not None and 'licence' in attrs:
            if attrs['licence'] != self.instance.licence:
                raise serializers.ValidationError({'licence': 'licence_change_via_licences'})
            attrs.pop('licence')
        # The kind and its university fields (models.COURSE_KIND_CHOICES). A university course
        # names its university — that is the whole of what makes it one, and the hub's filter finds
        # it by that name. A topic community carries none of the three: they are cleared rather
        # than refused, so switching an existing course from `university` to `topic` is one PATCH
        # of `kind` and never leaves a stale course code behind on a community.
        # The course above this one (`rules.py`, the tree section). Checked whenever the parent,
        # the kind or the visibility is being set, because all three decide the relation and its
        # refusals: a PATCH may move a course under another parent (2026-10-21 — the administrator
        # building the tree asks for that), and a PATCH that only narrows the parent's own
        # visibility is the parent's business, not this row's (`rules.visible_courses` reads it).
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        kind = attrs.get('kind', getattr(self.instance, 'kind', DEFAULT_COURSE_KIND))
        parent = attrs.get('parent', getattr(self.instance, 'parent', None))
        tree_touched = any(name in attrs for name in ('parent', 'kind', 'visibility'))
        placing = self.instance is None or (
            'parent' in attrs and attrs['parent'] != self.instance.parent
        )
        if parent is not None and (self.instance is None or tree_touched):
            reason = subcourse_block_reason(
                user,
                parent,
                visibility=attrs.get('visibility', getattr(self.instance, 'visibility', 'only_you')),
                kind=kind,
                instance=self.instance,
                placing=placing,
            )
            if reason:
                raise serializers.ValidationError({'parent': reason})
        for name in ('university', 'faculty', 'course_code', 'current_term'):
            if name in attrs:
                attrs[name] = (attrs[name] or '').strip()
        if kind == 'topic':
            attrs['university'] = ''
            attrs['faculty'] = ''
            attrs['course_code'] = ''
            attrs['current_term'] = ''
        elif not attrs.get('university', getattr(self.instance, 'university', '')):
            raise serializers.ValidationError(
                {'university': 'A university course names its university.'}
            )
        starts_on = attrs.get('starts_on', getattr(self.instance, 'starts_on', None))
        ends_on = attrs.get('ends_on', getattr(self.instance, 'ends_on', None))
        if starts_on and ends_on and ends_on < starts_on:
            raise serializers.ValidationError({'ends_on': 'A course cannot end before it starts.'})
        capacity = attrs.get('capacity', getattr(self.instance, 'capacity', 0))
        if self.instance and capacity:
            # Lowering the cap below the number of people already in is refused rather than silently
            # leaving the course over capacity — or, far worse, dropping somebody who had already
            # been let in.
            active = self.instance.active_participant_count
            if capacity < active:
                raise serializers.ValidationError(
                    {
                        'capacity': f'{active} people are already taking part; the limit cannot be '
                        'lower than that.'
                    }
                )
        return attrs


def guardians_for(user_ids) -> dict:
    """`{child_id: [guardian, ...]}` for a set of accounts — the roster's guardian column.

    Two queries for the whole roster rather than two per pupil, and built here rather than in the
    serializer so `participants` and anything else that grows a guardian column share the one
    definition. Revoked guardianships are left out: a guardian who withdrew consent is not who a
    teacher writes to, and the record of their consent (`accounts.Guardianship.revoked_at`, kept
    rather than deleted) is the accounts app's business and not a course's.
    """
    from accounts.models import Guardianship

    rows = Guardianship.objects.filter(
        child_id__in=list(user_ids), revoked_at__isnull=True
    ).select_related('guardian__profile')
    out: dict = {}
    for row in rows:
        out.setdefault(row.child_id, []).append(row.guardian)
    return out


class EnrollmentSerializer(serializers.ModelSerializer):
    participant = ParticipantSerializer(read_only=True)
    course_id = serializers.IntegerField(source='course.pk', read_only=True)
    course_title = serializers.CharField(source='course.title', read_only=True)
    # School mode (`courses/rules.py`): in a course an organisation of kind `school` runs, staff see
    # who answers for each pupil. **Always present, always a list** — `[]` rather than a missing key
    # for everybody else, the same reasoning `lesson_progress_payload` nulls rather than omits and
    # `get_participant_notes` blanks rather than omits: a client branches on a value, never on
    # whether a field exists. Filled only when the view puts `guardian_map` in the context, which it
    # does only after asking `rules.staff_sees_guardians`.
    guardians = serializers.SerializerMethodField()
    # Whether this participant is under 16 (`accounts/minors.py`). Sent beside the guardians rather
    # than inferred from "the list is empty", because those are two different facts: an adult has no
    # guardian, and so does a minor whose guardian revoked consent — and the second is the row a
    # teacher needs to chase. Only to the same viewers as `guardians`, for the same reason: a child's
    # age band is personal data, and a course roster is not where a stranger learns it.
    is_minor = serializers.SerializerMethodField()

    class Meta:
        model = Enrollment
        fields = [
            'id',
            'course_id',
            'course_title',
            'participant',
            'status',
            'request_note',
            'notify',
            'requested_at',
            'decided_at',
            'guardians',
            'is_minor',
        ]

    def get_guardians(self, enrollment):
        guardian_map = self.context.get('guardian_map')
        if not guardian_map:
            return []
        return ParticipantSerializer(
            guardian_map.get(enrollment.participant_id, []), many=True
        ).data

    def get_is_minor(self, enrollment) -> bool:
        if self.context.get('guardian_map') is None:
            return False
        profile = getattr(enrollment.participant, 'profile', None)
        return bool(profile and profile.is_minor)


class CourseStaffSerializer(serializers.ModelSerializer):
    user = ParticipantSerializer(read_only=True)

    class Meta:
        model = CourseStaff
        fields = ['id', 'user', 'role', 'added_at']


class CourseItemSerializer(serializers.ModelSerializer):
    kind = serializers.CharField(read_only=True)
    submitted_by = ParticipantSerializer(read_only=True)
    decided_by = ParticipantSerializer(read_only=True)
    label = serializers.SerializerMethodField()
    discussion_target_type = serializers.SerializerMethodField()
    discussion_target_id = serializers.SerializerMethodField()
    # The licence of what the item points at, when that thing carries one (a corpus material or
    # exercise, a file uploaded here), and how it sits with the course's own — `rules.item_licence_relation`.
    # Null for every other kind. The page draws a quiet note when the two differ (2026-11-02).
    target_licence = serializers.SerializerMethodField()
    licence_relation = serializers.SerializerMethodField()

    class Meta:
        model = CourseItem
        fields = [
            'id',
            'kind',
            # Who may see this one item (`models.ITEM_VISIBILITY_CHOICES`) — a narrowing of the
            # course's own rule, set by a curator.
            'visibility',
            'target_licence',
            'licence_relation',
            'lesson',
            'chapter',
            'material',
            'exercise',
            'attachment',
            'event',
            'discussion',
            # Null on every other kind. A linked thread is the one target this app cannot build a
            # link to from the item alone — a comment lives on whatever page its own target lives
            # on, and only the server can say which that is. See `community/targets.py`.
            'discussion_target_type',
            'discussion_target_id',
            # The three kinds of 2026-10-21: another EdMat course, an outside address with the
            # curator's title for it, a board post. Null / '' on every other kind.
            'linked_course',
            'link_url',
            'link_title',
            'post',
            'label',
            'order',
            'note',
            'status',
            'submitted_by',
            'decided_by',
            'decided_at',
            'decision_note',
            'created_at',
        ]

    def get_label(self, item) -> str:
        """Enough to recognise the thing without a second request.

        A material's title lives on its translations, so this resolves one through the same
        `resolve_translation` every other material response uses — reading `material.title` directly
        would not compile, and picking the first translation by hand would show a Polish title to an
        English reader. Falling back to the slug is what `MaterialSerializer.get_title` already does.

        An exercise has never had a title in this project: it is identified by its subject and
        number, which is exactly what `Exercise.__str__` composes, so this reuses that rather than
        inventing a second naming scheme for the same row.

        An attachment and an event both carry a plain `title` of their own, so neither needs
        resolving — they are course-local and single-language by construction.
        """
        if item.material_id:
            translation = resolve_translation(
                item.material.translations, request_locale(self.context)
            )
            return translation.title if translation else item.material.slug
        if item.exercise_id:
            return str(item.exercise)
        if item.attachment_id:
            return item.attachment.title
        if item.event_id:
            return item.event.title
        if item.linked_course_id:
            return item.linked_course.title
        if item.link_url:
            # The curator's title, or the address itself — a reader can judge an address they can
            # see, and an untitled link that said "Link" would tell them nothing.
            return item.link_title or item.link_url
        # A comment or a post has no title and never will — it is somebody talking. So the label is
        # the first words of it, which is what a reader recognises a thread by anyway ("the one
        # about the counterexample"). Truncated on a word boundary rather than mid-word, and the
        # body is read rather than the serializer's blanked version because a removed thread is
        # dropped from the response entirely one level up (`CourseItem.target_is_available_to`) —
        # anybody still holding this row is a curator, who is being shown it precisely so they can
        # replace it.
        source = item.post if item.post_id else item.discussion
        body = ' '.join((getattr(source, 'body', '') or '').split())
        return Truncator(body).words(12, truncate='…') or '—'

    def get_target_licence(self, item):
        return item_target_licence(item)

    def get_licence_relation(self, item):
        return item_licence_relation(item)

    def get_discussion_target_type(self, item) -> str:
        return target_type_for(item.discussion) if item.discussion_id else ''

    def get_discussion_target_id(self, item) -> str:
        return str(item.discussion.object_id) if item.discussion_id else ''



def _thread_belongs_to(comment, target_type, course) -> bool:
    """Is this private thread one of THIS course's own?

    The three branches are the three private target types a course can ever own. The rest of
    `PRIVATE_TARGET_TYPES` — a session's thread, a material version's review thread — belongs to
    something that is not a course at all and can never be one of ITS threads, so falling through
    to False is the right answer for them rather than an unhandled case: it refuses the link
    instead of leaking one, which is also what an actual gap in that set would get.
    """
    if target_type == 'taughtCourse':
        return comment.object_id == course.pk
    if target_type == 'courseLesson':
        return Lesson.objects.filter(
            pk=comment.object_id, chapter__course=course
        ).exists()
    if target_type == 'courseChapter':
        return Chapter.objects.filter(pk=comment.object_id, course=course).exists()
    return False


class CourseItemWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseItem
        fields = [
            'lesson',
            'chapter',
            'material',
            'exercise',
            'attachment',
            'event',
            'discussion',
            'linked_course',
            'link_url',
            'link_title',
            'post',
            'order',
            'note',
            'visibility',
        ]
        extra_kwargs = {
            'link_url': {'required': False, 'allow_blank': True},
            'link_title': {'required': False, 'allow_blank': True},
        }

    def validate_link_url(self, value):
        value = (value or '').strip()
        if value and not value.lower().startswith(('http://', 'https://')):
            # `URLField` would also take ftp:// — a course links to pages, not to file servers,
            # and a browser opening the former in a new tab is the only thing anybody expects.
            raise serializers.ValidationError('link_scheme')
        return value

    def validate(self, attrs):
        def resolved(name):
            return attrs.get(name, getattr(self.instance, name, None))

        target_names = (
            'material', 'exercise', 'attachment', 'event', 'discussion', 'linked_course',
            'link_url', 'post',
        )
        targets = {name: resolved(name) for name in target_names}
        chosen = [name for name, value in targets.items() if value]
        if len(chosen) != 1:
            raise serializers.ValidationError(
                'Reference exactly one of material, exercise, attachment, event, discussion, '
                'course, link or post.'
            )
        if 'link_title' in attrs:
            attrs['link_title'] = (attrs['link_title'] or '').strip()

        course = self.context.get('course')
        request = self.context.get('request')
        user = getattr(request, 'user', None)

        # Who may see it — a curator's call past `course` (`rules.item_visibility_block_reason`).
        # Asked only when the request SETS it, so a participant's plain offer is unaffected.
        if 'visibility' in attrs and course is not None:
            reason = item_visibility_block_reason(user, course, attrs['visibility'])
            if reason:
                raise serializers.ValidationError({'visibility': reason})

        # Another course: one THIS person can open (the same rule every course read applies —
        # `rules.course_visible_to`; an unlisted course they cannot see is "not found" to them,
        # house rule 4) and not this course itself. Nothing about who runs it: pointing a course at
        # somebody else's is the normal case, exactly as for an event.
        linked_course = attrs.get('linked_course')
        if linked_course is not None:
            if course is not None and linked_course.pk == course.pk:
                raise serializers.ValidationError({'linked_course': 'is_self'})
            if not course_visible_to(user, linked_course):
                raise serializers.ValidationError({'linked_course': 'not_found'})

        # A board post: one a reader may see now. A tombstoned or auto-hidden one is refused for
        # the same reason a removed thread is, below.
        post = attrs.get('post')
        if post is not None and not post.is_visible_to_readers():
            raise serializers.ValidationError({'post': 'That post is no longer available.'})

        # A lesson or chapter from another course would file this item somewhere its own course
        # cannot see. The database cannot express that constraint across the join, so it is checked
        # here. Read from `attrs` rather than `resolved`, because only a value being *set* by this
        # request needs checking — one already stored was checked when it was stored.
        lesson = attrs.get('lesson')
        chapter = attrs.get('chapter')
        if lesson and course and lesson.chapter.course_id != course.pk:
            raise serializers.ValidationError({'lesson': 'That lesson belongs to another course.'})
        if chapter and course and chapter.course_id != course.pk:
            raise serializers.ValidationError({'chapter': 'That chapter belongs to another course.'})
        if resolved('lesson') and resolved('chapter'):
            raise serializers.ValidationError(
                'File this into a lesson or a chapter, not both.'
            )

        # An attachment belongs to exactly one course, so pointing at another course's is both
        # meaningless and a real leak — an attachment is deliberately NOT discoverable outside its
        # own course, and linking one in would publish it to a roster it was never shared with.
        attachment = attrs.get('attachment')
        if attachment and course and attachment.course_id != course.pk:
            raise serializers.ValidationError(
                {'attachment': 'That file belongs to another course.'}
            )

        # An event is deliberately NOT checked for ownership: it has its own host and its own public
        # page, and pointing a course at somebody else's guest lecture is the normal case, not an
        # error. What is refused is a draft — it is not announced yet, so linking it would publish
        # somebody else's unfinished plan to this course's roster.
        event = attrs.get('event')
        if event and event.status == 'draft':
            raise serializers.ValidationError(
                {'event': 'That event has not been published yet.'}
            )

        # A thread, and the two things that make one linkable.
        #
        # First, it must be the START of a conversation. Every other target here is a whole thing;
        # a reply is half of one, and a course pointing at an answer with its question missing reads
        # as a mistake rather than as a link.
        #
        # Second — the real gate — a comment may be sitting somewhere that is not public. A course's
        # own discussion, and a week's or a session's inside it, are readable by that course's
        # participants and nobody else (`Course.discussion_mode` defaults to `participants` because
        # the roster is private). Linking one into a DIFFERENT course would publish it to a roster it
        # was never shared with, which is exactly what the attachment check above refuses, so it is
        # refused the same way. A course's own thread is fine — that is somebody filing this week's
        # question into this week, which is the case this feature was asked for.
        discussion = attrs.get('discussion')
        if discussion:
            if discussion.parent_id is not None:
                raise serializers.ValidationError(
                    {'discussion': 'Link the start of a thread, not a reply inside it.'}
                )
            if discussion.is_removed or discussion.auto_hidden_at is not None:
                raise serializers.ValidationError(
                    {'discussion': 'That comment is no longer available.'}
                )
            target_type = target_type_for(discussion)
            if target_type in PRIVATE_TARGET_TYPES:
                if course is None or not _thread_belongs_to(discussion, target_type, course):
                    raise serializers.ValidationError(
                        {'discussion': 'That discussion is private to another course.'}
                    )
        return attrs


class ChapterSerializer(serializers.ModelSerializer):
    is_unlocked = serializers.SerializerMethodField()
    lessons = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()
    exercise_sets = serializers.SerializerMethodField()
    reviews = serializers.SerializerMethodField()

    class Meta:
        model = Chapter
        fields = [
            'id',
            'title',
            'description',
            'order',
            'unlocks_at',
            'is_unlocked',
            'lessons',
            'items',
            'exercise_sets',
            'reviews',
        ]

    def get_reviews(self, chapter) -> dict:
        """Summary only, same as a lesson's — and present on a locked chapter too, since the count
        is about the chapter rather than its contents, exactly like its title and unlock date."""
        return rating_summary(chapter.reviews)

    def get_exercise_sets(self, chapter):
        """A set pinned into the week itself rather than into one of its sessions — the reading
        everybody does before Tuesday. Filtered by each link's own `is_visible_to`, exactly as the
        lesson-level field is, so a locked week's homework is staff-only like everything else in it.
        """
        visible = [link for link in chapter.exercise_sets.all() if link.is_visible_to(self._user())]
        return LessonExerciseSetSerializer(visible, many=True, context=self.context).data

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def get_is_unlocked(self, chapter) -> bool:
        """The chapter's own state, not this viewer's access to it.

        Deliberately the plain fact rather than "can I see it": a participant looking at a locked
        week should be told it is locked and when it opens, and staff looking at the same row need
        to know it is still shut even though they can read it.
        """
        return chapter.is_unlocked()

    def get_lessons(self, chapter):
        user = self._user()
        if not chapter.is_visible_to(user):
            # The chapter still renders — title, description and unlock date — but its contents do
            # not. That is the whole point of a locked chapter: you can see that week 3 exists,
            # without being shown what is in it yet.
            return []
        return LessonSerializer(
            chapter.lessons.all(), many=True, context=self.context
        ).data

    def get_items(self, chapter):
        """Content filed straight into this chapter rather than into one of its lessons.

        Filtered per viewer exactly as `Lesson.items` already is, so a pending contribution stays
        visible to staff and to whoever offered it and to nobody else. The lock check above already
        returned early, so what remains here is only the per-item status question.
        """
        user = self._user()
        if not chapter.is_visible_to(user):
            return []
        visible = [i for i in chapter.items.all() if i.is_visible_to(user)]
        return CourseItemSerializer(visible, many=True, context=self.context).data


class ChapterWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Chapter
        fields = ['title', 'description', 'order', 'unlocks_at']


class CourseInviteSerializer(serializers.ModelSerializer):
    created_by = ParticipantSerializer(read_only=True)
    is_usable = serializers.BooleanField(read_only=True)
    unusable_reason = serializers.SerializerMethodField()

    class Meta:
        model = CourseInvite
        fields = [
            'id',
            'token',
            'role',
            'label',
            'created_by',
            'created_at',
            'max_uses',
            'uses',
            'expires_at',
            'revoked_at',
            'is_usable',
            'unusable_reason',
            # The address a mailed invite went to; '' for a link made by hand, and '' again once
            # `accounts/retention.py` has forgotten it.
            'sent_to',
        ]

    def get_unusable_reason(self, invite) -> str | None:
        return invite.unusable_reason()


class CourseInviteWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseInvite
        fields = ['role', 'label', 'max_uses', 'expires_at']


class InvitePreviewSerializer(serializers.Serializer):
    """What somebody holding a link is told BEFORE they use it, and before they have logged in.

    Deliberately thin: a course's title and who runs it is enough to decide whether to accept, and an
    invite token is a URL that gets pasted into group chats — anything more here would be published
    to whoever it was forwarded to. Notably absent: the roster, the description, and the content.
    """

    course_id = serializers.IntegerField()
    course_title = serializers.CharField()
    instructor_name = serializers.CharField()
    role = serializers.CharField()
    is_usable = serializers.BooleanField()
    unusable_reason = serializers.CharField(allow_null=True)
    # What somebody joining as staff will be writing under — said before they accept, because
    # contributing to a course is contributing under its licence (`Course.licence`).
    course_licence = serializers.CharField()


class CourseNoteSerializer(serializers.ModelSerializer):
    """A person's own notes. There is deliberately no author field on the wire.

    Not an oversight: the only rows a caller can ever reach are their own, because
    `CourseNoteViewSet` filters by `author=request.user` before anything else. Serialising an author
    would imply the field can vary, and the first time somebody built a "notes for this course" view
    on that assumption it would be a privacy bug rather than a wrong label.
    """

    class Meta:
        model = CourseNote
        fields = ['id', 'lesson', 'body', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


class AttachmentReviewSerializer(serializers.ModelSerializer):
    author = ParticipantSerializer(read_only=True)

    class Meta:
        model = AttachmentReview
        fields = ['id', 'author', 'rating', 'body', 'created_at']
        read_only_fields = ['created_at']


class LessonReviewSerializer(serializers.ModelSerializer):
    author = ParticipantSerializer(read_only=True)

    class Meta:
        model = LessonReview
        fields = ['id', 'author', 'rating', 'body', 'created_at']
        read_only_fields = ['created_at']


class ChapterReviewSerializer(serializers.ModelSerializer):
    author = ParticipantSerializer(read_only=True)

    class Meta:
        model = ChapterReview
        fields = ['id', 'author', 'rating', 'body', 'created_at']
        read_only_fields = ['created_at']


class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by = ParticipantSerializer(read_only=True)
    can_change_visibility = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    size_bytes = serializers.IntegerField(read_only=True)
    review_count = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            'id',
            'title',
            'description',
            'file_url',
            'size_bytes',
            'licence',
            # Who in the course sees it, and whether THIS reader may change that — resolved here so
            # the page never works out a permission for itself.
            'visibility',
            'can_change_visibility',
            'uploaded_by',
            'created_at',
            'review_count',
            'average_rating',
        ]

    def get_file_url(self, attachment) -> str:
        """Absolute when a request is in context, so a client on another origin can follow it.

        Deliberately not the raw storage name: that is a path, not a link, and every other file in
        this API is already handed over as a URL."""
        if not attachment.file:
            return ''
        request = self.context.get('request')
        url = attachment.file.url
        return request.build_absolute_uri(url) if request else url

    def get_can_change_visibility(self, attachment) -> bool:
        from .rules import attachment_visibility_block_reason

        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return False
        return attachment_visibility_block_reason(user, attachment, attachment.visibility) is None

    def get_review_count(self, attachment) -> int:
        return len(attachment.reviews.all())

    def get_average_rating(self, attachment):
        """None rather than 0 when nobody has reviewed it. Zero is a rating somebody gave; absence
        is not, and a card that draws "0.0 stars" for an unreviewed file is telling a lie the data
        never said."""
        ratings = [review.rating for review in attachment.reviews.all()]
        return round(sum(ratings) / len(ratings), 2) if ratings else None


class AttachmentWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = ['file', 'title', 'description', 'licence', 'visibility']
        # Absent = the course's licence (the view passes it to `save`); the form prefills it.
        # Absent visibility = everyone in the course. Any uploader may narrow their own file.
        extra_kwargs = {'licence': {'required': False}, 'visibility': {'required': False}}

    def validate_licence(self, value):
        from licensing.licences import licence_validation_error

        reason = licence_validation_error(value)
        if reason:
            raise serializers.ValidationError(reason)
        return value

    def validate_file(self, upload):
        """An image is never stored as the bytes the uploader sent — see `attachmentfile.py` for why,
        and `accounts/avatar.py` for the long form. A PDF is returned untouched.

        In `validate_file` rather than in `create()`, which is where `events/serializers.py` does the
        equivalent for a post picture, for a reason specific to this write path: the view checks the
        course's upload quota against `validated_data['file']` between `is_valid()` and `save()`.
        Processing here means that gate weighs what will actually be *stored*, which is what the
        quota is spent on — `Course.uploaded_bytes` sums the stored files. Processing in `create()`
        would leave the gate charging the upload size while the accounting counted the much smaller
        re-encoded one, so a course could be refused a photo that would in fact have fitted.

        DRF runs a field's own validators before this method, so `validate_attachment_file` has
        already passed on the ORIGINAL upload by the time it is re-run here — cheap, and it keeps this
        function correct on its own rather than by trusting a caller's ordering.
        """
        return process_attachment_file(upload)


# --- covers / requires claims -------------------------------------------------------------------

from django.contrib.contenttypes.models import ContentType  # noqa: E402
from community.models import Comment  # noqa: E402
from materials.services import build_vote_summary  # noqa: E402
from taxonomy.serializers import SubtopicSerializer, TopicSerializer  # noqa: E402

from .models import CourseClaim  # noqa: E402


class CourseClaimSerializer(serializers.ModelSerializer):
    """The same wire shape as `MaterialCoverageSerializer`, with `course` where that one has
    `material` — the frontend maps both through one function."""

    topic = TopicSerializer(read_only=True)
    subtopic = SubtopicSerializer(read_only=True, allow_null=True)
    vote_summary = serializers.SerializerMethodField()
    importance_summary = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = CourseClaim
        fields = [
            'id',
            'course',
            'kind',
            'topic',
            'subtopic',
            'level',
            'proposed_by',
            'created_at',
            'vote_summary',
            'importance_summary',
            'comment_count',
        ]

    def get_vote_summary(self, obj):
        return build_vote_summary(
            list(obj.votes.select_related('voter__profile')), self.context.get('request')
        )

    def get_importance_summary(self, obj):
        return build_vote_summary(
            list(obj.importance_votes.select_related('voter__profile')), self.context.get('request')
        )

    def get_comment_count(self, obj):
        return Comment.objects.filter(
            content_type=ContentType.objects.get_for_model(CourseClaim),
            object_id=obj.pk,
            is_removed=False,
        ).count()


class CourseClaimCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseClaim
        fields = ['id', 'kind', 'topic', 'subtopic', 'level']


class CourseCompletionSerializer(serializers.ModelSerializer):
    """One completion certificate, carrying everything the printed sheet needs.

    Denormalized on purpose — the course title, its dates, the organisation behind it and the
    issuer's name all ride on the row's representation rather than being fetched by the page from
    four endpoints. The sheet is one request away from a URL somebody was handed, and a document
    that paints in four stages while the reader waits to press Print is a worse document.

    `note` is the basis, frozen at issue time (`CourseCompletion`'s docstring). `organization` is
    read live, because it is the one fact on the sheet that genuinely should follow a rename: a
    school that changed its name has the same identity, and the certificate is a claim about that
    body rather than about the string it used to be called.
    """

    participant = ParticipantSerializer(read_only=True)
    issued_by = ParticipantSerializer(read_only=True)
    course_id = serializers.IntegerField(source='course.pk', read_only=True)
    course_title = serializers.CharField(source='course.title', read_only=True)
    course_starts_on = serializers.DateField(source='course.starts_on', read_only=True)
    course_ends_on = serializers.DateField(source='course.ends_on', read_only=True)
    # The person the course names as running it, as a fallback for a certificate whose issuer has
    # since deleted their account (`issued_by` is SET_NULL). Always sent, so the sheet never has to
    # make a second request to say who stood behind a document it is already drawing.
    instructor = ParticipantSerializer(source='course.instructor', read_only=True)
    organization = serializers.SerializerMethodField()
    is_revoked = serializers.BooleanField(read_only=True)
    lessons_total = serializers.SerializerMethodField()

    class Meta:
        model = CourseCompletion
        fields = [
            'id',
            'course_id',
            'course_title',
            'course_starts_on',
            'course_ends_on',
            'instructor',
            'organization',
            'participant',
            'issued_by',
            'issued_at',
            'note',
            'revoked_at',
            'is_revoked',
            'lessons_total',
        ]

    def get_organization(self, completion) -> dict | None:
        """The body behind the course — ANY organisation with a `runs` link, not only a school.

        Wider than `courses/rules.is_school_course` on purpose: §4.5 says the certificate carries
        "the organisation if any", and a student circle that runs a reading group is as much the
        answer to "who ran this" as a school is. School mode is a question about guardians and
        progress; this is a question about whose name goes on a document.
        """
        from django.contrib.contenttypes.models import ContentType

        from organizations.models import OrganizationLink

        cache = self.context.setdefault('_completion_org_cache', {})
        course_id = completion.course_id
        if course_id not in cache:
            link = (
                OrganizationLink.objects.filter(
                    content_type=ContentType.objects.get_for_model(Course),
                    object_id=course_id,
                    kind='runs',
                    organization__is_active=True,
                )
                .select_related('organization')
                .first()
            )
            cache[course_id] = (
                None
                if link is None
                else {
                    'id': str(link.organization.pk),
                    'name': link.organization.name,
                    'slug': link.organization.slug,
                    'kind': link.organization.kind,
                }
            )
        return cache[course_id]

    def get_lessons_total(self, completion) -> int:
        """How many lessons the course has NOW — deliberately beside `note`, not instead of it.

        The note says what was true when the certificate was issued; this says what is true today.
        Both, because the honest thing for a reader who notices they differ is to be able to see
        that they differ, rather than to be shown one number dressed up as the other.
        """
        from . import rules

        cache = self.context.setdefault('_completion_lesson_total_cache', {})
        if completion.course_id not in cache:
            cache[completion.course_id] = rules.lesson_count(completion.course)
        return cache[completion.course_id]
