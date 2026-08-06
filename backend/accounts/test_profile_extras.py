"""Experience, skills, and the derived activity feed.

The rules worth pinning here are ownership (somebody else's entries are not yours to edit) and the
one claim that must not be self-assignable — `evidence='registry'` means an institution said so, and
a value anybody can type is worth what typing costs.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from courses.models import Enrollment, Course
from community.models import Review
from exercises.models import Tag
from taxonomy.models import Branch, Discipline
from telemetry.routers import all_log_shards
from testing.factories import make_course, make_exercise

from .models import ExperienceEntry, SkillEntry


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
