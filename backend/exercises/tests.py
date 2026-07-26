"""Part of this project's first real automated test suite (CLAUDE.md Section 17I/17K's own "no
formal automated test suite exists" note). Covers the core browsing/filtering contract (Section 7's
own functional requirement 1), the "resolve, fall back to original" locale behavior every
translatable model in this app shares (Section 10), the translation submission flow, and a
regression test for the shared-serializer-instance bug the moderation-queue load test found and fixed
(CLAUDE.md Section 17F) — a real data-integrity bug, not just a performance one, so it earns a
permanent regression test here rather than staying only a documented, one-time finding.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import ExerciseTranslation
from testing.factories import make_course, make_exercise, make_user


class ExerciseListingTests(APITestCase):
    def setUp(self):
        self.course = make_course()
        self.easy = make_exercise(self.course, 1, difficulty='easy')
        self.hard = make_exercise(self.course, 2, difficulty='hard')

    def test_course_exercises_lists_both(self):
        response = self.client.get(reverse('course-exercises', kwargs={'slug': self.course.slug}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row['id'] for row in response.data}
        self.assertEqual(ids, {self.easy.pk, self.hard.pk})

    def test_course_exercises_filters_by_difficulty(self):
        response = self.client.get(
            reverse('course-exercises', kwargs={'slug': self.course.slug}), {'difficulty': 'hard'}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row['id'] for row in response.data}
        self.assertEqual(ids, {self.hard.pk})


class ExerciseLocaleResolutionTests(APITestCase):
    """CLAUDE.md Section 10's "resolve, fall back to original" behavior — a reader always sees the
    published translation for their requested `?lang=`, falling back to the original locale when
    none exists yet for the one they asked for."""

    def setUp(self):
        self.course = make_course()
        self.exercise = make_exercise(self.course, 1, locale='pl', title='Polska wersja')

    def test_lang_param_resolves_to_a_real_translation_when_one_exists(self):
        ExerciseTranslation.objects.create(
            exercise=self.exercise,
            locale='en',
            title='English version',
            statement='English statement.',
            status='published',
        )

        response = self.client.get(
            reverse('exercise-detail', kwargs={'pk': self.exercise.pk}), {'lang': 'en'}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['title'], 'English version')
        self.assertEqual(response.data['resolved_locale'], 'en')

    def test_lang_param_falls_back_to_original_locale_when_untranslated(self):
        response = self.client.get(
            reverse('exercise-detail', kwargs={'pk': self.exercise.pk}), {'lang': 'de'}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['title'], 'Polska wersja')
        self.assertEqual(response.data['resolved_locale'], 'pl')


class ExerciseTranslationSubmissionTests(APITestCase):
    def setUp(self):
        self.course = make_course()
        self.exercise = make_exercise(self.course, 1)

    def test_authenticated_user_can_submit_a_translation(self):
        self.client.force_authenticate(make_user('translator'))

        response = self.client.post(
            reverse('exercise-translations', kwargs={'pk': self.exercise.pk}),
            {'locale': 'en', 'title': 'A translation', 'statement': 'Translated statement.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        translation = self.exercise.translations.get(locale='en')
        self.assertEqual(translation.status, 'pending')

    def test_anonymous_user_cannot_submit_a_translation(self):
        response = self.client.post(
            reverse('exercise-translations', kwargs={'pk': self.exercise.pk}),
            {'locale': 'en', 'title': 'A translation', 'statement': 'Translated statement.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(self.exercise.translations.filter(locale='en').exists())


class ExerciseBulkEndpointTests(APITestCase):
    """Regression test for the real, found-before-first-use data-integrity bug CLAUDE.md Section
    17F documents: ExerciseDetailSerializer used to cache its resolved translation on `self`, which
    DRF's `ListSerializer` shares as ONE instance across every row under `many=True` — every exercise
    past the first in a bulk response showed the FIRST one's own title/statement instead of its own.
    Fixed by caching on the per-row object instead; this test locks that fix in place."""

    def test_each_exercise_in_a_bulk_response_keeps_its_own_distinct_content(self):
        course = make_course()
        exercises = [
            make_exercise(course, n, title=f'Title {n}', statement=f'Statement {n}.')
            for n in range(1, 6)
        ]

        response = self.client.get(
            reverse('exercise-bulk'), {'ids': ','.join(str(e.pk) for e in exercises)}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 5)
        titles = [row['title'] for row in response.data]
        statements = [row['statement'] for row in response.data]
        self.assertEqual(len(titles), len(set(titles)), 'every exercise must keep its own distinct title')
        self.assertEqual(
            len(statements), len(set(statements)), 'every exercise must keep its own distinct statement'
        )
