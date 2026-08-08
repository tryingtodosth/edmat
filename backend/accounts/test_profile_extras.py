"""Experience, skills, certificates, and the derived activity feed.

The rules worth pinning here are ownership (somebody else's entries are not yours to edit), the one
claim that must not be self-assignable — `evidence='registry'` means an institution said so, and a
value anybody can type is worth what typing costs — and, for the feed, that it never shows a reader
more than they are allowed to see nor less to the person it is about.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from courses.models import Chapter, Course, Enrollment, Lesson, LessonProgress
from community.models import Review
from exercises.models import Tag
from taxonomy.models import Branch, Discipline
from telemetry.routers import all_log_shards
from testing.factories import make_course, make_exercise, make_material

from .models import Certificate, ExperienceEntry, SkillEntry


class ApiTestCase(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.me = User.objects.create_user('ania', 'ania@x.example', 'pw12345!')
        self.other = User.objects.create_user('piotr', 'piotr@x.example', 'pw12345!')
        self.client = APIClient()

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client


class ExperienceTests(ApiTestCase):
    def test_entries_are_public_but_only_the_owner_writes_them(self):
        created = self.as_(self.me).post(
            '/api/me/experience/', {'title': 'Korepetycje', 'kind': 'teaching'}, format='json'
        )
        self.assertEqual(created.status_code, 201)

        public = self.client.get(f'/api/users/{self.me.pk}/extras/')
        self.assertEqual([e['title'] for e in public.data['experience']], ['Korepetycje'])

        # Somebody else's row is not in their queryset at all, so it 404s rather than 403s.
        stolen = self.as_(self.other).patch(
            f'/api/me/experience/{created.data["id"]}/', {'title': 'Mine now'}, format='json'
        )
        self.assertEqual(stolen.status_code, 404)

    def test_an_ongoing_entry_keeps_a_null_end_date(self):
        """Null means ongoing, which the UI renders as "present" — genuinely different from unknown."""
        res = self.as_(self.me).post(
            '/api/me/experience/',
            {'title': 'Studia', 'started_on': '2023-10-01'},
            format='json',
        )
        self.assertIsNone(res.data['ended_on'])

    def test_writing_requires_an_account(self):
        self.assertEqual(
            self.client.post('/api/me/experience/', {'title': 'x'}, format='json').status_code, 401
        )


class SkillTests(ApiTestCase):
    def test_registry_evidence_cannot_be_claimed_by_typing_it(self):
        res = self.as_(self.me).post(
            '/api/me/skills/', {'label': 'Analiza', 'evidence': 'registry'}, format='json'
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['evidence'], 'self_declared')

    def test_ordinary_evidence_values_are_kept(self):
        res = self.as_(self.me).post(
            '/api/me/skills/', {'label': 'LaTeX', 'evidence': 'coursework'}, format='json'
        )
        self.assertEqual(res.data['evidence'], 'coursework')

    def test_one_row_per_label(self):
        client = self.as_(self.me)
        client.post('/api/me/skills/', {'label': 'Analiza'}, format='json')
        duplicate = client.post('/api/me/skills/', {'label': 'Analiza'}, format='json')
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(SkillEntry.objects.filter(profile=self.me.profile).count(), 1)

    def test_a_skill_can_name_a_real_course_and_reports_its_slug(self):
        field = Discipline.objects.create(slug='matematyka')
        branch = Branch.objects.create(slug='analiza-2', discipline=field)
        self.as_(self.me).post(
            '/api/me/skills/', {'label': 'Analiza II', 'branch': branch.pk}, format='json'
        )
        public = self.client.get(f'/api/users/{self.me.pk}/extras/')
        self.assertEqual(public.data['skills'][0]['branch_slug'], 'analiza-2')


class ActivityFeedTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        # The repo's own shared fixtures rather than hand-built taxonomy rows — the real shape has
        # translations and a topic, and rebuilding that by hand here would just be a second, wronger
        # copy of `testing/factories.py`.
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.exercise.submitted_by = self.me
        self.exercise.published = True
        self.exercise.save()
        self.tag = Tag.objects.create(slug='analiza')
        self.exercise.tags.add(self.tag)

    def test_the_feed_merges_several_kinds_and_reports_which(self):
        Review.objects.create(exercise=self.exercise, author=self.me, rating=5, body='Dobre')
        taught = Course.objects.create(instructor=self.me, title='Analiza od zera', status='open')
        joined = Course.objects.create(instructor=self.other, title='Inny', status='open')
        Enrollment.objects.create(course=joined, participant=self.me, status='active')

        res = self.client.get(f'/api/users/{self.me.pk}/activity/')
        kinds = {item['kind'] for item in res.data['items']}
        self.assertEqual(kinds, {'exercise', 'review', 'course_taught', 'course_joined'})
        self.assertIn('course_taught', res.data['kinds'])
        titles = [i['title'] for i in res.data['items']]
        self.assertIn(taught.title, titles)

    def test_tags_come_from_real_data_so_filtering_by_one_means_something(self):
        Review.objects.create(exercise=self.exercise, author=self.me, rating=4, body='ok')
        res = self.client.get(f'/api/users/{self.me.pk}/activity/')
        self.assertEqual(res.data['tags'], ['analiza'])
        review = next(i for i in res.data['items'] if i['kind'] == 'review')
        self.assertEqual(review['tags'], ['analiza'])

    def test_undated_items_sort_last_rather_than_being_dropped(self):
        """The imported corpus carries no submission timestamp; a fake date would be worse."""
        Review.objects.create(exercise=self.exercise, author=self.me, rating=4, body='ok')
        items = self.client.get(f'/api/users/{self.me.pk}/activity/').data['items']
        self.assertIsNone(items[-1]['created_at'])
        self.assertEqual(items[-1]['kind'], 'exercise')

    def test_a_removed_review_leaves_the_feed(self):
        review = Review.objects.create(exercise=self.exercise, author=self.me, rating=1, body='x')
        review.is_removed = True
        review.save()
        kinds = {i['kind'] for i in self.client.get(f'/api/users/{self.me.pk}/activity/').data['items']}
        self.assertNotIn('review', kinds)

    def test_an_unknown_user_gets_an_empty_feed_rather_than_an_error(self):
        res = self.client.get('/api/users/999999/activity/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['items'], [])


class CertificateTests(ApiTestCase):
    """A credential a third party issued, and the holder's word that they did.

    The rules worth pinning are the same two ownership/uniqueness ones the sections above pin, plus
    the one this model adds: expiry is answered server-side, so a public profile and the owner's own
    editor cannot disagree about whether something is still valid.
    """

    def test_certificates_are_public_but_only_the_owner_writes_them(self):
        created = self.as_(self.me).post(
            '/api/me/certificates/',
            {'title': 'CAE (C1)', 'issuer': 'Cambridge', 'issued_on': '2023-06-15'},
            format='json',
        )
        self.assertEqual(created.status_code, 201)

        public = self.client.get(f'/api/users/{self.me.pk}/extras/')
        self.assertEqual([c['title'] for c in public.data['certificates']], ['CAE (C1)'])

        stolen = self.as_(self.other).patch(
            f'/api/me/certificates/{created.data["id"]}/', {'title': 'Mine now'}, format='json'
        )
        self.assertEqual(stolen.status_code, 404)

    def test_writing_requires_an_account(self):
        self.assertEqual(
            self.client.post('/api/me/certificates/', {'title': 'x'}, format='json').status_code,
            401,
        )

    def test_the_same_certificate_from_the_same_issuer_is_refused_as_a_bad_request(self):
        """Not a 500. DRF derives uniqueness validators from `unique_together` and NOT from
        `Meta.constraints`, which is what this model uses — so without the serializer's own check the
        database constraint surfaces as an IntegrityError."""
        body = {'title': 'CAE (C1)', 'issuer': 'Cambridge'}
        self.assertEqual(self.as_(self.me).post('/api/me/certificates/', body, format='json').status_code, 201)
        second = self.as_(self.me).post('/api/me/certificates/', body, format='json')
        self.assertEqual(second.status_code, 400)
        self.assertIn('title', second.data)

    def test_the_same_title_from_a_different_issuer_is_a_different_certificate(self):
        """The constraint spans both columns on purpose — "Data Science" from two providers is two
        real credentials, and refusing the second would be wrong."""
        self.as_(self.me).post(
            '/api/me/certificates/', {'title': 'Data Science', 'issuer': 'A'}, format='json'
        )
        second = self.as_(self.me).post(
            '/api/me/certificates/', {'title': 'Data Science', 'issuer': 'B'}, format='json'
        )
        self.assertEqual(second.status_code, 201)

    def test_two_people_may_hold_the_same_certificate(self):
        body = {'title': 'CAE (C1)', 'issuer': 'Cambridge'}
        self.assertEqual(self.as_(self.me).post('/api/me/certificates/', body, format='json').status_code, 201)
        self.assertEqual(self.as_(self.other).post('/api/me/certificates/', body, format='json').status_code, 201)

    def test_expiry_is_answered_by_the_server_rather_than_by_each_client(self):
        past = self.as_(self.me).post(
            '/api/me/certificates/',
            {'title': 'Pierwsza pomoc', 'expires_on': '2020-01-01'},
            format='json',
        )
        self.assertTrue(past.data['is_expired'])

        future = self.as_(self.me).post(
            '/api/me/certificates/',
            {'title': 'Something else', 'expires_on': '2099-01-01'},
            format='json',
        )
        self.assertFalse(future.data['is_expired'])

    def test_no_expiry_date_is_not_the_same_as_an_expired_one(self):
        """NULL means "does not expire", which is genuinely different from a date that has passed."""
        res = self.as_(self.me).post('/api/me/certificates/', {'title': 'Warsztat'}, format='json')
        self.assertIsNone(res.data['expires_on'])
        self.assertFalse(res.data['is_expired'])

    def test_is_expired_cannot_be_asserted_by_the_caller(self):
        res = self.as_(self.me).post(
            '/api/me/certificates/',
            {'title': 'Wishful', 'expires_on': '2020-01-01', 'is_expired': False},
            format='json',
        )
        self.assertTrue(res.data['is_expired'])

    def test_an_unknown_user_gets_empty_lists_rather_than_an_error(self):
        res = self.client.get('/api/users/999999/extras/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['certificates'], [])


class ActivityFeedVisibilityTests(ApiTestCase):
    """The three sources of this feed that are not uniformly public.

    Its promise is that it answers with exactly as much as THIS reader may see — never more, and never
    less to the person it is about. Each of the three is private for a different reason, so each is
    pinned separately rather than through one blanket "is this me" assertion.
    """

    def setUp(self):
        super().setUp()
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.exercise.published = True
        self.exercise.save()

    def _kinds_for(self, client):
        return {i['kind'] for i in client.get(f'/api/users/{self.me.pk}/activity/').data['items']}

    def test_a_private_set_is_visible_to_its_owner_and_to_nobody_else(self):
        from study.models import ExerciseSet

        ExerciseSet.objects.create(owner=self.me, name='Prywatne', is_public=False)

        self.assertIn('saved_set', self._kinds_for(self.as_(self.me)))
        self.assertNotIn('saved_set', self._kinds_for(self.client))
        self.assertNotIn('saved_set', self._kinds_for(self.as_(self.other)))

    def test_a_shared_set_is_visible_to_a_stranger(self):
        from study.models import ExerciseSet

        shared = ExerciseSet.objects.create(owner=self.me, name='Kolokwium 2', is_public=True)
        items = self.client.get(f'/api/users/{self.me.pk}/activity/').data['items']
        row = next(i for i in items if i['kind'] == 'saved_set')
        # The slug, not the pk: it is what `ExerciseSetViewSet` resolves a set by and what /sets/[id]
        # expects, so sending the pk would produce a link that 404s.
        self.assertEqual(row['set_id'], shared.slug)
        self.assertTrue(row['is_public'])

    def test_a_finished_lesson_is_never_shown_to_an_anonymous_reader(self):
        """`Course.progress_visible_to` requires membership, and a stranger has none. Progress is the
        instructor's promise to their participants about who is watching; a profile page is not an
        exception to it."""
        course = Course.objects.create(
            instructor=self.other, title='RP', status='running', progress_visibility='shared_anonymous'
        )
        chapter = Chapter.objects.create(course=course, title='Program')
        lesson = Lesson.objects.create(chapter=chapter, title='Zmienne losowe', order=1)
        Enrollment.objects.create(course=course, participant=self.me, status='active')
        LessonProgress.objects.create(lesson=lesson, participant=self.me, status='done')

        self.assertNotIn('lesson_done', self._kinds_for(self.client))
        self.assertIn('lesson_done', self._kinds_for(self.as_(self.me)))

    def test_a_course_that_turned_progress_off_hides_it_from_the_participant_too(self):
        """`off` blinds everybody, staff included — that is the point of the setting rather than an
        oversight, so the feed must not become a way around it."""
        course = Course.objects.create(
            instructor=self.other, title='RP', status='running', progress_visibility='off'
        )
        chapter = Chapter.objects.create(course=course, title='Program')
        lesson = Lesson.objects.create(chapter=chapter, title='Zmienne losowe', order=1)
        Enrollment.objects.create(course=course, participant=self.me, status='active')
        LessonProgress.objects.create(lesson=lesson, participant=self.me, status='done')

        self.assertNotIn('lesson_done', self._kinds_for(self.as_(self.me)))

    def test_only_a_finished_lesson_counts_as_finished(self):
        course = Course.objects.create(
            instructor=self.other, title='RP', status='running', progress_visibility='shared_anonymous'
        )
        chapter = Chapter.objects.create(course=course, title='Program')
        lesson = Lesson.objects.create(chapter=chapter, title='Ciągi', order=1)
        Enrollment.objects.create(course=course, participant=self.me, status='active')
        LessonProgress.objects.create(lesson=lesson, participant=self.me, status='stuck')

        self.assertNotIn('lesson_done', self._kinds_for(self.as_(self.me)))

    def test_counts_never_advertise_something_the_feed_withheld(self):
        """The summary tiles read `counts`, so a count taken before filtering would promise a stranger
        a row they then cannot see — which is worse than not offering the tile."""
        from study.models import ExerciseSet

        ExerciseSet.objects.create(owner=self.me, name='Prywatne', is_public=False)
        stranger = self.client.get(f'/api/users/{self.me.pk}/activity/').data
        self.assertNotIn('saved_set', stranger['counts'])
        mine = self.as_(self.me).get(f'/api/users/{self.me.pk}/activity/').data
        self.assertEqual(mine['counts']['saved_set'], 1)


class ActivityFeedCoverageTests(ApiTestCase):
    """The kinds this feed used to miss, each of which made a real part of somebody's history invisible."""

    def setUp(self):
        super().setUp()
        self.branch = make_course()

    def test_a_submitted_material_counts_as_posted(self):
        material = make_material(self.branch)
        material.submitted_by = self.me
        material.published = True
        material.save()

        items = self.client.get(f'/api/users/{self.me.pk}/activity/').data['items']
        row = next(i for i in items if i['kind'] == 'material')
        self.assertEqual(row['material_id'], material.pk)

    def test_an_unpublished_material_is_not_advertised(self):
        material = make_material(self.branch)
        material.submitted_by = self.me
        material.published = False
        material.save()
        self.assertNotIn(
            'material',
            {i['kind'] for i in self.client.get(f'/api/users/{self.me.pk}/activity/').data['items']},
        )

    def test_a_tutoring_review_counts_as_reviewed(self):
        """The public profile has listed these since tutoring shipped; the feed did not know about
        them, so filtering by "review" showed only half of somebody's."""
        from services.models import Service, ServiceReview

        service = Service.objects.create(provider=self.other, title='Korepetycje z analizy')
        ServiceReview.objects.create(service=service, author=self.me, rating=5, body='Polecam')

        items = self.client.get(f'/api/users/{self.me.pk}/activity/').data['items']
        row = next(i for i in items if i['kind'] == 'service_review')
        self.assertEqual(row['title'], 'Korepetycje z analizy')
        self.assertEqual(row['rating'], 5)

    def test_a_removed_tutoring_review_leaves_the_feed(self):
        from services.models import Service, ServiceReview

        service = Service.objects.create(provider=self.other, title='Korepetycje')
        review = ServiceReview.objects.create(service=service, author=self.me, rating=1, body='x')
        review.is_removed = True
        review.save()
        self.assertNotIn(
            'service_review',
            {i['kind'] for i in self.client.get(f'/api/users/{self.me.pk}/activity/').data['items']},
        )


class SeedProfileShowcaseTests(ApiTestCase):
    """The command whose whole job is that the profile screens have something to render."""

    def _run(self, **kwargs):
        from django.core.management import call_command

        call_command('seed_profile_showcase', user='ania', verbosity=0, **kwargs)

    def test_it_refuses_an_account_that_does_not_exist(self):
        from django.core.management import call_command
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError):
            call_command('seed_profile_showcase', user='nobody-here', verbosity=0)

    def test_it_fills_every_section_the_profile_renders(self):
        self._run()
        profile = User.objects.get(username='ania').profile
        self.assertTrue(profile.bio)
        self.assertEqual(profile.experience.count(), 5)
        self.assertEqual(profile.skills.count(), 6)
        self.assertEqual(profile.certificates.count(), 4)

    def test_it_produces_a_transcript_spanning_more_than_one_year(self):
        """The point of the whole per-year view: one year of results cannot demonstrate it."""
        from identity.models import EducationProfile, grades_by_year

        self._run()
        education = EducationProfile.objects.get(user__username='ania')
        years = grades_by_year(list(education.grades.all()))
        self.assertGreaterEqual(len(years), 3)
        self.assertTrue(all(row['average'] is not None for row in years))

    def test_it_shows_all_three_kinds_of_skill_evidence(self):
        """The distinction between them is the whole point of the field; a demo showing one makes the
        badge look decorative."""
        self._run()
        profile = User.objects.get(username='ania').profile
        self.assertEqual(
            {s.evidence for s in profile.skills.all()},
            {'self_declared', 'coursework', 'registry'},
        )

    def test_it_leaves_one_shared_set_and_one_private_one(self):
        from study.models import ExerciseSet

        self._run()
        sets = ExerciseSet.objects.filter(owner__username='ania')
        self.assertEqual({s.is_public for s in sets}, {True, False})

    def test_it_does_not_leave_the_usos_mock_switched_on(self):
        """A seed that left it enabled would make the running site claim to verify people it cannot."""
        from django.conf import settings

        before = getattr(settings, 'EDMAT_USOS_MOCK', False)
        self._run()
        self.assertEqual(getattr(settings, 'EDMAT_USOS_MOCK', False), before)

    def test_it_is_idempotent(self):
        from identity.models import CourseGrade

        self._run()
        first = (
            ExperienceEntry.objects.count(),
            SkillEntry.objects.count(),
            Certificate.objects.count(),
            CourseGrade.objects.count(),
            Review.objects.count(),
        )
        self._run()
        self.assertEqual(
            first,
            (
                ExperienceEntry.objects.count(),
                SkillEntry.objects.count(),
                Certificate.objects.count(),
                CourseGrade.objects.count(),
                Review.objects.count(),
            ),
        )

    def test_reset_removes_what_it_made_and_leaves_what_it_did_not(self):
        from identity.models import CourseGrade

        self._run()
        profile = User.objects.get(username='ania').profile
        mine = Certificate.objects.create(profile=profile, title='Mój własny', issuer='ja')

        self._run(reset=True)
        # Re-created, not duplicated…
        self.assertEqual(profile.certificates.filter(title='Certificate in Advanced English (C1)').count(), 1)
        # …and the hand-added row survived the reset, which is what makes it safe to run twice.
        self.assertTrue(Certificate.objects.filter(pk=mine.pk).exists())
        self.assertTrue(CourseGrade.objects.filter(profile__user=profile.user).exists())


class SeedDemoContentTests(ApiTestCase):
    """The seed is what a new person's first impression is made of, so it is worth testing."""

    def test_it_is_idempotent(self):
        from django.core.management import call_command

        call_command('seed_demo_content', verbosity=0)
        first = (ExperienceEntry.objects.count(), SkillEntry.objects.count(), User.objects.count())
        call_command('seed_demo_content', verbosity=0)
        second = (ExperienceEntry.objects.count(), SkillEntry.objects.count(), User.objects.count())
        self.assertEqual(first, second)

    def test_it_produces_profiles_with_something_on_them(self):
        from django.core.management import call_command

        call_command('seed_demo_content', verbosity=0)
        ania = User.objects.get(username='demo-ania')
        self.assertTrue(ania.profile.bio)
        self.assertTrue(ania.profile.experience.exists())
        self.assertTrue(ania.profile.skills.exists())
        self.assertTrue(Course.objects.filter(instructor=ania).exists())

    def test_it_leaves_a_pending_request_for_the_instructor_to_act_on(self):
        from django.core.management import call_command

        call_command('seed_demo_content', verbosity=0)
        self.assertTrue(Enrollment.objects.filter(status='pending').exists())

    def test_it_leaves_an_unlisted_course_of_each_kind_so_visibility_is_demonstrable(self):
        from django.core.management import call_command

        call_command('seed_demo_content', verbosity=0)
        self.assertTrue(Course.objects.filter(visibility='only_you').exists())
        self.assertTrue(Course.objects.filter(visibility='private').exists())


class DisplayPreferenceTests(ApiTestCase):
    """How somebody wants their own clock and calendar drawn.

    Two things worth pinning rather than trusting: that the DEFAULTS are 24-hour and Monday whatever
    interface language the account reads in — the whole reason these are stored fields rather than an
    inference from the locale — and that they are the account holder's own business, not a stranger's.
    """

    def test_a_new_account_gets_24_hour_and_monday(self):
        response = self.as_(self.me).get('/api/auth/me/')
        self.assertEqual(response.data['time_format'], '24h')
        self.assertEqual(response.data['week_starts_on'], 'monday')

    def test_the_default_does_not_follow_the_interface_language(self):
        """An English reader who has said nothing still gets 24-hour. `Intl`'s own per-locale default
        would hand them 4:00 PM, which was the behaviour before these fields existed and was nobody's
        choice."""
        self.me.profile.preferred_locale = 'en'
        self.me.profile.save()

        response = self.as_(self.me).get('/api/auth/me/')
        self.assertEqual(response.data['time_format'], '24h')

    def test_both_can_be_changed(self):
        response = self.as_(self.me).patch(
            '/api/auth/me/', {'time_format': '12h', 'week_starts_on': 'sunday'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.me.profile.refresh_from_db()
        self.assertEqual(self.me.profile.time_format, '12h')
        self.assertEqual(self.me.profile.week_starts_on, 'sunday')

    def test_a_value_outside_the_two_choices_is_refused(self):
        response = self.as_(self.me).patch(
            '/api/auth/me/', {'time_format': '36h'}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_they_are_not_on_somebody_elses_public_profile(self):
        """Not because a clock preference is sensitive, but because a stranger's settings are not a
        public endpoint's business — the same reasoning PublicProfileSerializer already applies to the
        notification preferences."""
        response = self.as_(self.other).get(f'/api/users/{self.me.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('time_format', response.data)
        self.assertNotIn('week_starts_on', response.data)
