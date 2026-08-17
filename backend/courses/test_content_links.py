"""Linking a discussion into a course, and pinning a set to a week rather than to a session.

Its own module rather than more of `tests.py`, which is already 4000 lines: this is a coherent
feature and reading it should not mean scrolling past the roster rules to find it.

Weighted at refusals, on the same reasoning `tests.py` states for itself — the properties that fail
silently. Two matter most here and neither is obvious from the happy path: a thread private to
somebody else's course must not become linkable by knowing its id, and a thread whose opening post
has been taken down must stop being shown to participants while staying visible to the person who
can replace it.
"""

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from rest_framework.test import APIClient

from community.models import Comment
from exercises.models import Exercise
from study.models import ExerciseSet, ExerciseSetItem
from taxonomy.models import Branch, Discipline
from telemetry.routers import all_log_shards
from testing.factories import make_exercise

from django.test import TestCase

from .models import Chapter, Course, CourseItem, Lesson, LessonExerciseSet


class ContentLinkTestCase(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.instructor = User.objects.create_user('kasia', 'kasia@x.example', 'pw12345!')
        self.student = User.objects.create_user('michal', 'michal@x.example', 'pw12345!')
        self.discipline = Discipline.objects.create(slug='matematyka')
        self.subject = Branch.objects.create(slug='analiza-2', discipline=self.discipline)
        self.exercise = make_exercise(self.subject, number=1)
        self.course = Course.objects.create(
            instructor=self.instructor,
            title='Analiza od zera',
            visibility='public',
            status='open',
            enrollment_policy='open',
            contribution_policy='staff',
        )
        self.chapter = Chapter.objects.create(course=self.course, title='Week 1', order=0)
        self.lesson = Lesson.objects.create(chapter=self.chapter, title='Mon', order=0)

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def comment_on(self, target, *, author=None, body='Why is step 3 allowed?', parent=None):
        return Comment.objects.create(
            content_type=ContentType.objects.get_for_model(target),
            object_id=target.pk,
            author=author or self.student,
            body=body,
            parent=parent,
        )

    def link_discussion(self, comment, **extra):
        payload = {'discussion': comment.pk, 'chapter': self.chapter.pk}
        payload.update(extra)
        return self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/items/', payload, format='json'
        )


class DiscussionLinkTests(ContentLinkTestCase):
    def test_a_thread_becomes_a_real_item_the_course_can_name_and_reach(self):
        """The whole point of a row rather than a link in the description: the course can say what
        the thread is and where to read it, neither of which a pasted string can do."""
        comment = self.comment_on(self.exercise)
        res = self.link_discussion(comment)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['kind'], 'discussion')
        # A comment has no title, so the label is its opening words — what a reader recognises a
        # conversation by.
        self.assertIn('Why is step 3', res.data['label'])
        # Where to read it. Only the server can answer this: a comment hangs off whatever its own
        # target hangs off, and the row only knows a ContentType id.
        self.assertEqual(res.data['discussion_target_type'], 'exercise')
        self.assertEqual(res.data['discussion_target_id'], str(self.exercise.pk))

    def test_a_reply_is_refused_because_half_a_conversation_is_not_a_thread(self):
        root = self.comment_on(self.exercise)
        reply = self.comment_on(self.exercise, parent=root, body='Because the norm is complete.')
        res = self.link_discussion(reply)
        self.assertEqual(res.status_code, 400)
        self.assertIn('discussion', res.data)

    def test_a_removed_comment_cannot_be_linked_at_all(self):
        comment = self.comment_on(self.exercise)
        comment.is_removed = True
        comment.save(update_fields=['is_removed'])
        self.assertEqual(self.link_discussion(comment).status_code, 400)

    def test_an_auto_hidden_comment_cannot_be_linked_either(self):
        comment = self.comment_on(self.exercise)
        comment.auto_hidden_at = timezone.now()
        comment.save(update_fields=['auto_hidden_at'])
        self.assertEqual(self.link_discussion(comment).status_code, 400)

    def test_the_same_thread_twice_in_one_course_is_refused(self):
        comment = self.comment_on(self.exercise)
        self.assertEqual(self.link_discussion(comment).status_code, 201)
        second = self.link_discussion(comment, chapter=None, lesson=self.lesson.pk)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data['detail'], 'already_in_course')

    def test_a_thread_private_to_another_course_is_refused(self):
        """The gate this feature turns on. A course's own discussion is readable by its
        participants; linking one into a different course would publish it to a roster it was never
        shared with — the same leak the attachment check already refuses."""
        other = Course.objects.create(
            instructor=self.student, title='Somebody else’s course', visibility='public'
        )
        private = self.comment_on(other, author=self.student, body='Only for us')
        res = self.link_discussion(private)
        self.assertEqual(res.status_code, 400)
        self.assertIn('private', str(res.data['discussion'][0]).lower())

    def test_this_courses_own_thread_is_fine(self):
        """The case the feature was actually asked for: filing this week's question into this week.
        Same privacy class as the one above, and the opposite answer, because it is already theirs."""
        mine = self.comment_on(self.course, body='How should we approach week 1?')
        self.assertEqual(self.link_discussion(mine).status_code, 201)

    def test_a_lessons_own_thread_is_fine_too(self):
        mine = self.comment_on(self.lesson, body='Is task 3 a typo?')
        self.assertEqual(self.link_discussion(mine).status_code, 201)

    def test_a_taken_down_thread_disappears_for_a_participant_and_stays_for_a_curator(self):
        """The half nobody notices. The link is approved and its chapter is open, so it renders —
        regardless of whether the thread underneath it is still there. A curator keeps seeing it
        because they are the person who can replace it; a list that silently got shorter tells them
        nothing."""
        comment = self.comment_on(self.exercise)
        self.assertEqual(self.link_discussion(comment).status_code, 201)

        def chapter_items(user):
            client = self.as_(user) if user else APIClient()
            res = client.get(f'/api/courses/{self.course.pk}/')
            self.assertEqual(res.status_code, 200)
            return res.data['chapters'][0]['items']

        self.assertEqual(len(chapter_items(self.student)), 1)

        comment.is_removed = True
        comment.save(update_fields=['is_removed'])

        self.assertEqual(chapter_items(self.student), [])
        self.assertEqual(len(chapter_items(self.instructor)), 1)

    def test_a_stranger_cannot_file_content_into_a_staff_only_course(self):
        comment = self.comment_on(self.exercise)
        res = self.as_(self.student).post(
            f'/api/courses/{self.course.pk}/items/',
            {'discussion': comment.pk, 'chapter': self.chapter.pk},
            format='json',
        )
        self.assertIn(res.status_code, (400, 403, 404))
        self.assertFalse(CourseItem.objects.filter(discussion=comment).exists())


class ChapterExerciseSetTests(ContentLinkTestCase):
    """A whole set pinned to the week rather than to one of its sessions.

    The endpoint is the same one lessons already used — the level a link hangs off is a column, so
    it is a URL segment rather than a second pair of views.
    """

    def setUp(self):
        super().setUp()
        self.set = ExerciseSet.objects.create(
            owner=self.instructor, name='Week 1 homework', is_public=True
        )
        ExerciseSetItem.objects.create(exercise_set=self.set, exercise=self.exercise, order=0)

    def sets_url(self, kind, pk):
        return f'/api/courses/{self.course.pk}/{kind}/{pk}/exercise-sets/'

    def test_a_set_pins_to_a_chapter(self):
        res = self.as_(self.instructor).post(
            self.sets_url('chapters', self.chapter.pk), {'set': self.set.slug}, format='json'
        )
        self.assertEqual(res.status_code, 201, res.data)
        link = LessonExerciseSet.objects.get(pk=res.data['id'])
        self.assertEqual(link.chapter_id, self.chapter.pk)
        # Exactly one parent, never both — the database refuses the alternative outright.
        self.assertIsNone(link.lesson_id)
        self.assertEqual([row.exercise_id for row in link.exercises.all()], [self.exercise.pk])

    def test_it_shows_up_on_the_chapter_rather_than_on_a_lesson(self):
        self.as_(self.instructor).post(
            self.sets_url('chapters', self.chapter.pk), {'set': self.set.slug}, format='json'
        )
        res = self.as_(self.student).get(f'/api/courses/{self.course.pk}/')
        chapter = res.data['chapters'][0]
        self.assertEqual(len(chapter['exercise_sets']), 1)
        self.assertEqual(chapter['exercise_sets'][0]['title'], 'Week 1 homework')
        self.assertEqual(chapter['lessons'][0]['exercise_sets'], [])

    def test_the_lesson_level_still_works_unchanged(self):
        """The URL grew a segment; what it did before must still mean the same thing."""
        res = self.as_(self.instructor).post(
            self.sets_url('lessons', self.lesson.pk), {'set': self.set.slug}, format='json'
        )
        self.assertEqual(res.status_code, 201, res.data)
        link = LessonExerciseSet.objects.get(pk=res.data['id'])
        self.assertEqual(link.lesson_id, self.lesson.pk)
        self.assertIsNone(link.chapter_id)

    def test_the_same_set_twice_in_one_chapter_is_refused(self):
        self.as_(self.instructor).post(
            self.sets_url('chapters', self.chapter.pk), {'set': self.set.slug}, format='json'
        )
        again = self.as_(self.instructor).post(
            self.sets_url('chapters', self.chapter.pk), {'set': self.set.slug}, format='json'
        )
        self.assertEqual(again.status_code, 400)

    def test_a_locked_chapter_keeps_its_homework_from_participants_but_not_from_staff(self):
        self.as_(self.instructor).post(
            self.sets_url('chapters', self.chapter.pk), {'set': self.set.slug}, format='json'
        )
        self.chapter.unlocks_at = timezone.now() + timezone.timedelta(days=7)
        self.chapter.save(update_fields=['unlocks_at'])

        res = self.as_(self.student).get(self.sets_url('chapters', self.chapter.pk))
        self.assertEqual(res.data, [])
        res = self.as_(self.instructor).get(self.sets_url('chapters', self.chapter.pk))
        self.assertEqual(len(res.data), 1)

    def test_a_chapter_from_another_course_is_not_found(self):
        elsewhere = Course.objects.create(instructor=self.student, title='Theirs')
        their_chapter = Chapter.objects.create(course=elsewhere, title='Week 1')
        res = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/chapters/{their_chapter.pk}/exercise-sets/',
            {'set': self.set.slug},
            format='json',
        )
        self.assertEqual(res.status_code, 404)

    def test_a_chapter_level_link_reorders_through_the_same_endpoint(self):
        """Group ids are prefixed for set links because a chapter and a lesson have separate id
        sequences — a bare `7` cannot say which of the two it means."""
        second = ExerciseSet.objects.create(owner=self.instructor, name='Extra', is_public=True)
        ExerciseSetItem.objects.create(exercise_set=second, exercise=self.exercise, order=0)
        first_id = self.as_(self.instructor).post(
            self.sets_url('chapters', self.chapter.pk), {'set': self.set.slug}, format='json'
        ).data['id']
        second_id = self.as_(self.instructor).post(
            self.sets_url('chapters', self.chapter.pk), {'set': second.slug}, format='json'
        ).data['id']

        res = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/reorder/',
            {
                'kind': 'lesson_set',
                'groups': {f'chapter:{self.chapter.pk}': [second_id, first_id]},
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(
            list(
                LessonExerciseSet.objects.filter(chapter=self.chapter)
                .order_by('order')
                .values_list('pk', flat=True)
            ),
            [second_id, first_id],
        )

    def test_a_bare_group_id_still_means_a_lesson(self):
        """Every reorder payload written before chapters were possible sent a bare lesson id, and
        must keep meaning exactly what it did."""
        link_id = self.as_(self.instructor).post(
            self.sets_url('lessons', self.lesson.pk), {'set': self.set.slug}, format='json'
        ).data['id']
        res = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/reorder/',
            {'kind': 'lesson_set', 'groups': {str(self.lesson.pk): [link_id]}},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(LessonExerciseSet.objects.get(pk=link_id).lesson_id, self.lesson.pk)

    def test_dragging_a_link_from_a_lesson_onto_a_chapter_clears_the_lesson(self):
        """Both columns are written in one statement. Holding both is what the exactly-one-parent
        constraint refuses outright, which would be a 500 on an ordinary drag."""
        link_id = self.as_(self.instructor).post(
            self.sets_url('lessons', self.lesson.pk), {'set': self.set.slug}, format='json'
        ).data['id']
        res = self.as_(self.instructor).post(
            f'/api/courses/{self.course.pk}/reorder/',
            {'kind': 'lesson_set', 'groups': {f'chapter:{self.chapter.pk}': [link_id]}},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)
        link = LessonExerciseSet.objects.get(pk=link_id)
        self.assertEqual(link.chapter_id, self.chapter.pk)
        self.assertIsNone(link.lesson_id)
