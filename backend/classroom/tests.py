"""What matters about a course somebody runs is who can see it and who can get into it.

So most of these pin boundaries rather than happy paths: a draft is invisible, a roster is not
public, a full course refuses, a removed person cannot walk back in, and participant-only lesson
notes stay out of an outsider's response. Those are the properties that fail silently — a broken
create flow announces itself immediately; a roster leaking to strangers does not.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from taxonomy.models import Course as Subject, Field
from telemetry.routers import all_log_shards

from .models import Enrollment, Lesson, TaughtCourse


class ApiTestCase(TestCase):
    """The request-logging middleware writes to its own shards; a view test that does not declare
    them fails on Django's cross-database guard rather than on anything under test."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.instructor = User.objects.create_user('kasia', 'kasia@x.example', 'pw12345!')
        self.student = User.objects.create_user('michal', 'michal@x.example', 'pw12345!')
        self.other = User.objects.create_user('ola', 'ola@x.example', 'pw12345!')
        self.field = Field.objects.create(slug='matematyka')
        self.subject = Subject.objects.create(slug='analiza-2', field=self.field, university='UW')
        self.client = APIClient()

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def make_course(self, **kwargs):
        defaults = {
            'instructor': self.instructor,
            'title': 'Analiza od zera',
            'status': 'open',
            'enrollment_policy': 'open',
        }
        return TaughtCourse.objects.create(**{**defaults, **kwargs})


class VisibilityTests(ApiTestCase):
    def test_a_draft_is_invisible_to_everybody_but_its_instructor(self):
        draft = self.make_course(status='draft')
        anon = self.client.get('/api/taught-courses/')
        self.assertNotIn(draft.pk, [c['id'] for c in anon.data])

        stranger = self.as_(self.student).get('/api/taught-courses/')
        self.assertNotIn(draft.pk, [c['id'] for c in stranger.data])

        mine = self.as_(self.instructor).get('/api/taught-courses/')
        self.assertIn(draft.pk, [c['id'] for c in mine.data])

    def test_a_published_course_is_public_without_an_account(self):
        course = self.make_course()
        res = self.client.get(f'/api/taught-courses/{course.pk}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['title'], 'Analiza od zera')
        self.assertFalse(res.data['can_enrol'])  # anonymous
        self.assertEqual(res.data['enrollment_block_reason'], 'authentication_required')

    def test_courses_are_discoverable_by_subject(self):
        course = self.make_course()
        course.subjects.add(self.subject)
        self.make_course(title='Unrelated')
        res = self.client.get('/api/taught-courses/?subject=analiza-2')
        self.assertEqual([c['id'] for c in res.data], [course.pk])


class EnrolmentTests(ApiTestCase):
    def test_open_policy_admits_immediately(self):
        course = self.make_course()
        res = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'active')
        self.assertEqual(course.active_participant_count, 1)

    def test_approval_policy_parks_the_request(self):
        course = self.make_course(enrollment_policy='approval')
        res = self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/enrol/', {'request_note': 'I am in year 2'}, format='json'
        )
        self.assertEqual(res.data['status'], 'pending')
        self.assertEqual(res.data['request_note'], 'I am in year 2')
        # A pending request is not a seat.
        self.assertEqual(course.active_participant_count, 0)

    def test_the_instructor_approves_and_the_seat_is_taken(self):
        course = self.make_course(enrollment_policy='approval')
        enrol = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/enrollments/{enrol.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(res.data['status'], 'active')
        self.assertEqual(course.active_participant_count, 1)

    def test_only_the_instructor_decides(self):
        course = self.make_course(enrollment_policy='approval')
        enrol = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.other).post(
            f'/api/taught-courses/{course.pk}/enrollments/{enrol.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(res.status_code, 404)

    def test_a_full_course_refuses_and_says_so(self):
        course = self.make_course(capacity=1)
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'full')

    def test_approving_into_a_full_course_is_refused_too(self):
        """The cap has to hold on the instructor's path as well, or it is not a cap."""
        course = self.make_course(enrollment_policy='approval', capacity=1)
        first = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        second = self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        client = self.as_(self.instructor)
        client.post(
            f'/api/taught-courses/{course.pk}/enrollments/{first.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        res = client.post(
            f'/api/taught-courses/{course.pk}/enrollments/{second.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'full')

    def test_a_closed_course_does_not_take_new_people(self):
        course = self.make_course(status='running')
        res = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'not_open')

    def test_an_instructor_cannot_enrol_in_their_own_course(self):
        course = self.make_course()
        res = self.as_(self.instructor).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'instructor_cannot_enrol')

    def test_asking_twice_does_not_queue_twice(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'already_enrolled')
        self.assertEqual(Enrollment.objects.filter(course=course).count(), 1)

    def test_leaving_frees_the_seat_and_re_joining_reuses_the_row(self):
        course = self.make_course(capacity=1)
        client = self.as_(self.student)
        client.post(f'/api/taught-courses/{course.pk}/enrol/')
        client.post(f'/api/taught-courses/{course.pk}/leave/')
        self.assertEqual(course.active_participant_count, 0)
        again = client.post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(again.data['status'], 'active')
        self.assertEqual(Enrollment.objects.filter(course=course).count(), 1)

    def test_somebody_removed_cannot_simply_walk_back_in(self):
        course = self.make_course()
        enrol = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/enrollments/{enrol.data["id"]}/',
            {'decision': 'remove'},
            format='json',
        )
        res = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(res.data['detail'], 'removed')


class RosterTests(ApiTestCase):
    def test_the_roster_is_not_public(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(self.client.get(f'/api/taught-courses/{course.pk}/participants/').status_code, 401)
        self.assertEqual(
            self.as_(self.other).get(f'/api/taught-courses/{course.pk}/participants/').status_code, 403
        )

    def test_participants_see_each_other_and_the_instructor_sees_requests(self):
        course = self.make_course(enrollment_policy='approval')
        active = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/enrollments/{active.data["id"]}/',
            {'decision': 'approve'},
            format='json',
        )
        self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')

        as_participant = self.as_(self.student).get(f'/api/taught-courses/{course.pk}/participants/')
        self.assertEqual([r['status'] for r in as_participant.data], ['active'])

        as_instructor = self.as_(self.instructor).get(f'/api/taught-courses/{course.pk}/participants/')
        self.assertEqual(sorted(r['status'] for r in as_instructor.data), ['active', 'pending'])


class LessonTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.course = self.make_course()
        self.lesson = Lesson.objects.create(
            course=self.course,
            title='Ciągi',
            description='Public blurb',
            participant_notes='The zoom link and the homework',
        )

    def test_an_outsider_sees_the_lesson_but_not_the_notes(self):
        res = self.client.get(f'/api/taught-courses/{self.course.pk}/')
        lesson = res.data['lessons'][0]
        self.assertEqual(lesson['title'], 'Ciągi')
        self.assertEqual(lesson['description'], 'Public blurb')
        # Present but empty rather than absent — the response shape must not change with the caller.
        self.assertEqual(lesson['participant_notes'], '')

    def test_a_participant_sees_the_notes(self):
        client = self.as_(self.student)
        client.post(f'/api/taught-courses/{self.course.pk}/enrol/')
        res = client.get(f'/api/taught-courses/{self.course.pk}/')
        self.assertEqual(res.data['lessons'][0]['participant_notes'], 'The zoom link and the homework')

    def test_a_pending_request_is_not_yet_a_participant(self):
        course = self.make_course(enrollment_policy='approval')
        Lesson.objects.create(course=course, title='L', participant_notes='secret')
        client = self.as_(self.student)
        client.post(f'/api/taught-courses/{course.pk}/enrol/')
        res = client.get(f'/api/taught-courses/{course.pk}/')
        self.assertEqual(res.data['lessons'][0]['participant_notes'], '')

    def test_only_the_instructor_adds_lessons(self):
        res = self.as_(self.student).post(
            f'/api/taught-courses/{self.course.pk}/lessons/', {'title': 'Mine now'}, format='json'
        )
        self.assertEqual(res.status_code, 404)

    def test_the_instructor_adds_and_edits_lessons(self):
        client = self.as_(self.instructor)
        created = client.post(
            f'/api/taught-courses/{self.course.pk}/lessons/',
            {'title': 'Szeregi', 'order': 2},
            format='json',
        )
        self.assertEqual(created.status_code, 201)
        edited = client.patch(
            f'/api/taught-courses/{self.course.pk}/lessons/{created.data["id"]}/',
            {'title': 'Szeregi liczbowe'},
            format='json',
        )
        self.assertEqual(edited.data['title'], 'Szeregi liczbowe')


class AuthoringTests(ApiTestCase):
    def test_a_new_course_starts_as_a_draft_even_if_asked_otherwise(self):
        """Creating is not publishing — but an explicit status is still honoured, since an
        instructor who deliberately sets 'open' means it."""
        res = self.as_(self.instructor).post(
            '/api/taught-courses/', {'title': 'Nowy kurs'}, format='json'
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'draft')
        self.assertTrue(res.data['is_instructor'])

    def test_the_creator_becomes_the_instructor_regardless_of_what_was_sent(self):
        res = self.as_(self.student).post(
            '/api/taught-courses/',
            {'title': 'Not yours', 'instructor': self.instructor.pk},
            format='json',
        )
        self.assertEqual(res.data['instructor']['id'], self.student.pk)

    def test_somebody_elses_course_cannot_be_edited_or_deleted(self):
        course = self.make_course()
        client = self.as_(self.student)
        self.assertEqual(
            client.patch(f'/api/taught-courses/{course.pk}/', {'title': 'x'}, format='json').status_code,
            404,
        )
        self.assertEqual(client.delete(f'/api/taught-courses/{course.pk}/').status_code, 404)

    def test_the_cap_cannot_be_cut_below_the_people_already_admitted(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        res = self.as_(self.instructor).patch(
            f'/api/taught-courses/{course.pk}/', {'capacity': 1}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('capacity', res.data)

    def test_a_course_cannot_end_before_it_starts(self):
        res = self.as_(self.instructor).post(
            '/api/taught-courses/',
            {'title': 'Backwards', 'starts_on': '2026-03-01', 'ends_on': '2026-02-01'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('ends_on', res.data)

    def test_my_courses_split_into_teaching_and_participating(self):
        teaching = self.make_course(title='I run this')
        joining = self.make_course(title='I attend this', instructor=self.other)
        client = self.as_(self.instructor)
        self.as_(self.instructor).post(f'/api/taught-courses/{joining.pk}/enrol/')

        mine_teaching = client.get('/api/taught-courses/?mine=teaching')
        self.assertEqual([c['id'] for c in mine_teaching.data], [teaching.pk])

        mine_attending = client.get('/api/taught-courses/?mine=participating')
        self.assertEqual([c['id'] for c in mine_attending.data], [joining.pk])


class KillSwitchTests(ApiTestCase):
    def test_the_feature_flag_hides_the_whole_surface(self):
        """Matching every other kill switch here: off means gone for an ordinary visitor, reads
        included, while a real moderator keeps access to manage what already exists."""
        from moderation.models import FeatureFlag

        self.make_course()
        FeatureFlag.objects.update_or_create(key='classroom', defaults={'is_enabled': False})
        # 401 anonymous, 403 signed in — DRF's own distinction, and the same pair every other gated
        # endpoint in this project already returns.
        self.assertEqual(self.client.get('/api/taught-courses/').status_code, 401)
        self.assertEqual(self.as_(self.student).get('/api/taught-courses/').status_code, 403)

        staff = User.objects.create_user('mod', 'mod@x.example', 'pw12345!', is_staff=True)
        self.assertEqual(self.as_(staff).get('/api/taught-courses/').status_code, 200)


class DiscussionTests(ApiTestCase):
    """Reading and posting are two different questions, and `discussion_mode` only answers the first."""

    def setUp(self):
        super().setUp()
        self.course = self.make_course()

    def post_as(self, user, body='Cześć'):
        return self.as_(user).post(
            f'/api/taught-courses/{self.course.pk}/comments/', {'body': body}, format='json'
        )

    def test_participants_only_is_the_default(self):
        self.assertEqual(self.course.discussion_mode, 'participants')
        self.assertEqual(
            self.client.get(f'/api/taught-courses/{self.course.pk}/comments/').status_code, 403
        )
        self.assertEqual(
            self.as_(self.other).get(f'/api/taught-courses/{self.course.pk}/comments/').status_code,
            403,
        )

    def test_a_participant_reads_and_posts(self):
        self.as_(self.student).post(f'/api/taught-courses/{self.course.pk}/enrol/')
        posted = self.post_as(self.student)
        self.assertEqual(posted.status_code, 201)
        read = self.as_(self.student).get(f'/api/taught-courses/{self.course.pk}/comments/')
        self.assertEqual([c['body'] for c in read.data], ['Cześć'])

    def test_the_instructor_is_in_the_conversation_without_being_on_the_roster(self):
        self.assertEqual(self.post_as(self.instructor).status_code, 201)

    def test_a_public_thread_is_readable_but_not_writable_by_outsiders(self):
        """The whole point of two separate checks: open to read, closed to post."""
        self.course.discussion_mode = 'public'
        self.course.save()
        self.as_(self.instructor).post(
            f'/api/taught-courses/{self.course.pk}/comments/', {'body': 'Witam'}, format='json'
        )
        anon = self.client.get(f'/api/taught-courses/{self.course.pk}/comments/')
        self.assertEqual(anon.status_code, 200)
        self.assertEqual([c['body'] for c in anon.data], ['Witam'])
        self.assertEqual(self.post_as(self.other).status_code, 403)

    def test_turning_the_discussion_off_closes_it_for_everybody(self):
        self.as_(self.student).post(f'/api/taught-courses/{self.course.pk}/enrol/')
        self.course.discussion_mode = 'off'
        self.course.save()
        self.assertEqual(
            self.as_(self.student).get(f'/api/taught-courses/{self.course.pk}/comments/').status_code,
            403,
        )
        self.assertEqual(self.post_as(self.student).status_code, 403)
        # Including the instructor: off means off, not "off for other people".
        self.assertEqual(self.post_as(self.instructor).status_code, 403)

    def test_a_pending_request_does_not_get_into_the_conversation(self):
        course = self.make_course(enrollment_policy='approval')
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(
            self.as_(self.student).get(f'/api/taught-courses/{course.pk}/comments/').status_code, 403
        )

    def test_a_reply_cannot_be_smuggled_in_from_another_thread(self):
        other_course = self.make_course(title='Elsewhere')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{other_course.pk}/comments/', {'body': 'root'}, format='json'
        )
        from community.models import Comment

        foreign = Comment.objects.first()
        res = self.as_(self.instructor).post(
            f'/api/taught-courses/{self.course.pk}/comments/',
            {'body': 'reply', 'parent': foreign.pk},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('parent', res.data)

    def test_the_viewer_is_told_what_they_may_do(self):
        detail = self.client.get(f'/api/taught-courses/{self.course.pk}/').data
        self.assertFalse(detail['can_read_discussion'])
        self.assertFalse(detail['can_post_discussion'])
        self.as_(self.student).post(f'/api/taught-courses/{self.course.pk}/enrol/')
        detail = self.as_(self.student).get(f'/api/taught-courses/{self.course.pk}/').data
        self.assertTrue(detail['can_read_discussion'])
        self.assertTrue(detail['can_post_discussion'])


class NotificationTests(ApiTestCase):
    def notifs(self, user, type_=None):
        from notifications.models import Notification

        qs = Notification.objects.filter(recipient=user)
        return qs.filter(type=type_) if type_ else qs

    def test_asking_to_join_tells_the_instructor_and_carries_the_note(self):
        course = self.make_course(enrollment_policy='approval')
        self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/enrol/', {'request_note': 'Rok drugi'}, format='json'
        )
        row = self.notifs(self.instructor, 'course_enrollment_requested').get()
        self.assertEqual(row.target_label, course.title)
        self.assertEqual(row.taught_course_id, course.pk)
        self.assertEqual(row.note, 'Rok drugi')

    def test_joining_an_open_course_notifies_nobody(self):
        """Otherwise a popular course buries its instructor in noise they cannot act on."""
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.assertEqual(self.notifs(self.instructor).count(), 0)

    def test_every_decision_reaches_the_person_it_is_about(self):
        for decision, expected in (
            ('approve', 'course_enrollment_approved'),
            ('decline', 'course_enrollment_declined'),
            ('remove', 'course_removed'),
        ):
            course = self.make_course(enrollment_policy='approval')
            enrol = self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
            self.as_(self.instructor).post(
                f'/api/taught-courses/{course.pk}/enrollments/{enrol.data["id"]}/',
                {'decision': decision},
                format='json',
            )
            self.assertTrue(
                self.notifs(self.student, expected).filter(taught_course=course).exists(), decision
            )

    def test_a_new_lesson_reaches_participants_but_not_the_instructor(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notifs(self.student, 'course_new_lesson').count(), 1)
        # notify()'s own actor==recipient guard: nobody is told about their own action.
        self.assertEqual(self.notifs(self.instructor, 'course_new_lesson').count(), 0)

    def test_a_post_reaches_the_other_people_in_the_conversation(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/comments/', {'body': 'Pytanie'}, format='json'
        )
        self.assertEqual(self.notifs(self.other, 'course_new_post').count(), 1)
        self.assertEqual(self.notifs(self.instructor, 'course_new_post').count(), 1)
        self.assertEqual(self.notifs(self.student, 'course_new_post').count(), 0)

    def test_a_pending_request_is_never_told_what_is_happening_inside(self):
        """Leaking course activity to somebody not admitted would undo the participants-only rule."""
        course = self.make_course(enrollment_policy='approval')
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notifs(self.student, 'course_new_lesson').count(), 0)


class NotificationSettingTests(ApiTestCase):
    """Three independent switches, at three levels, each of which must work on its own."""

    def notif_count(self, user, type_):
        from notifications.models import Notification

        return Notification.objects.filter(recipient=user, type=type_).count()

    def test_the_instructor_can_stop_announcing_lessons(self):
        course = self.make_course(announce_new_lessons=False)
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)

    def test_the_instructor_can_stop_announcing_posts(self):
        course = self.make_course(announce_new_posts=False)
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.other).post(f'/api/taught-courses/{course.pk}/enrol/')
        self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/comments/', {'body': 'x'}, format='json'
        )
        self.assertEqual(self.notif_count(self.other, 'course_new_post'), 0)

    def test_a_participant_can_mute_one_course_without_leaving_it(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        muted = self.as_(self.student).post(
            f'/api/taught-courses/{course.pk}/mute/', {'notify': False}, format='json'
        )
        self.assertEqual(muted.status_code, 200)
        self.assertFalse(muted.data['notify'])
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)
        # Still genuinely in the course — muting is not leaving.
        self.assertEqual(course.active_participant_count, 1)

    def test_muting_is_reversible_and_reported_back(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        client = self.as_(self.student)
        client.post(f'/api/taught-courses/{course.pk}/mute/', {'notify': False}, format='json')
        self.assertFalse(client.get(f'/api/taught-courses/{course.pk}/').data['notify_me'])
        client.post(f'/api/taught-courses/{course.pk}/mute/', {'notify': True}, format='json')
        self.assertTrue(client.get(f'/api/taught-courses/{course.pk}/').data['notify_me'])

    def test_notify_me_is_null_for_somebody_not_in_the_course(self):
        """Distinct from False, which means "in the course, muted"."""
        course = self.make_course()
        self.assertIsNone(self.as_(self.other).get(f'/api/taught-courses/{course.pk}/').data['notify_me'])

    def test_only_a_participant_can_mute(self):
        course = self.make_course()
        res = self.as_(self.other).post(
            f'/api/taught-courses/{course.pk}/mute/', {'notify': False}, format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_the_account_wide_category_switches_all_six_off(self):
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        profile = self.student.profile
        profile.notify_on_course_activity = False
        profile.save()
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)

    def test_one_type_can_be_muted_without_the_rest(self):
        """The per-type list layers on top of the coarse category, never instead of it."""
        course = self.make_course()
        self.as_(self.student).post(f'/api/taught-courses/{course.pk}/enrol/')
        profile = self.student.profile
        profile.muted_notification_types = ['course_new_lesson']
        profile.save()
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/lessons/', {'title': 'Ciągi'}, format='json'
        )
        self.as_(self.instructor).post(
            f'/api/taught-courses/{course.pk}/comments/', {'body': 'x'}, format='json'
        )
        self.assertEqual(self.notif_count(self.student, 'course_new_lesson'), 0)
        self.assertEqual(self.notif_count(self.student, 'course_new_post'), 1)

    def test_settings_are_the_instructors_alone_to_change(self):
        course = self.make_course()
        res = self.as_(self.student).patch(
            f'/api/taught-courses/{course.pk}/', {'discussion_mode': 'off'}, format='json'
        )
        self.assertEqual(res.status_code, 404)
        ok = self.as_(self.instructor).patch(
            f'/api/taught-courses/{course.pk}/', {'discussion_mode': 'public'}, format='json'
        )
        self.assertEqual(ok.data['discussion_mode'], 'public')
