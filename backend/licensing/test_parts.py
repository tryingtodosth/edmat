"""A set-shaped exercise's PARTS and the licence (§17CV.A, `SUBEXERCISES-BRIEF.md` §2): a part has
no licence column, by design — it is the exercise's own text and is covered by `Exercise.licence`.
What this pins is that neither the per-item change (`rules.change_licence`, through its endpoint)
nor the bulk command (`relicense_content`) breaks on, or loses, an exercise with parts, and that
the exercise's own translation rows still move exactly as before beside them."""

from __future__ import annotations

from io import StringIO

from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import Exercise, ExercisePart, ExercisePartTranslation, ExerciseTranslation, SolutionEntry
from licensing.models import LicenceChange
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user


def give_parts(exercise):
    for order, label in enumerate('ab', start=1):
        part = ExercisePart.objects.create(exercise=exercise, order=order, label=label)
        ExercisePartTranslation.objects.create(part=part, locale='pl', statement=f'Part {label}.', status='published')
        ExercisePartTranslation.objects.create(part=part, locale='en', statement=f'Part {label} (en).', status='published')
        SolutionEntry.objects.create(exercise=exercise, part=part, kind='solution', locale='pl', body=f'Sol {label}.', status='published', pinned=True, licence='unknown')


class PartsLicenceTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch('lic-parts')
        self.author = make_user('lic-parts-author')
        self.staff = make_user('lic-parts-staff', is_staff=True)
        self.exercise = make_exercise(self.branch, 1)
        Exercise.objects.filter(pk=self.exercise.pk).update(submitted_by=self.author)
        give_parts(self.exercise)
        self.corpus = make_exercise(self.branch, 2)
        Exercise.objects.filter(pk=self.corpus.pk).update(licence='unknown')
        ExerciseTranslation.objects.filter(exercise=self.corpus).update(licence='unknown')
        give_parts(self.corpus)

    def parts_of(self, exercise):
        return [
            (p['label'], p['statement'])
            for p in self.client.get(f'/api/exercises/{exercise.pk}/?lang=pl').data['parts']
        ]

    def test_the_author_widens_an_exercise_with_parts_and_the_parts_stay_as_they_were(self):
        before = self.parts_of(self.exercise)
        self.client.force_authenticate(self.author)
        response = self.client.post(f'/api/licences/exercise/{self.exercise.pk}/', {'licence': 'cc-by-sa-4.0'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(ExerciseTranslation.objects.get(exercise=self.exercise).licence, 'cc-by-sa-4.0')
        self.assertEqual(self.parts_of(self.exercise), before)
        self.assertEqual(ExercisePartTranslation.objects.filter(part__exercise=self.exercise).count(), 4)
        # The part solutions are their authors' own works and keep theirs.
        self.assertEqual(set(SolutionEntry.objects.filter(exercise=self.exercise).values_list('licence', flat=True)), {'unknown'})
        self.assertEqual(LicenceChange.objects.count(), 1)

    def test_the_bulk_command_moves_an_exercise_with_parts_and_its_part_solutions(self):
        out = StringIO()
        call_command('relicense_content', to='cc-by-sa-4.0', by='lic-parts-staff', note='Cleared', stdout=out)
        text = out.getvalue()
        self.assertIn('exercise: 1 changed (1 from unknown)', text)
        self.assertIn(f'licence_other_contributors (1): {self.exercise.pk}', text)
        self.assertIn('solution_entry: 4 changed (4 from unknown)', text)
        self.corpus.refresh_from_db()
        self.assertEqual(self.corpus.licence, 'cc-by-sa-4.0')
        self.assertEqual(ExerciseTranslation.objects.get(exercise=self.corpus).licence, 'cc-by-sa-4.0')
        self.assertEqual(self.parts_of(self.corpus), [('a', 'Part a.'), ('b', 'Part b.')])
        self.assertTrue(Exercise.objects.get(pk=self.corpus.pk).verified)  # every part still solved
