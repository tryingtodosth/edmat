"""Sub-exercises (`SUBEXERCISES-BRIEF.md`, 2026-10-21): the parts of a set-shaped exercise, their
text resolved per language, and an entry that is for one part. The prep commit pins the read shape
and the entry POST's `part`; step A of the build adds the rest of the rules to this file."""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import ExercisePart, ExercisePartTranslation, SolutionEntry
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user


def make_part(exercise, order, label, statement, *, answer='', locale='pl'):
    part = ExercisePart.objects.create(exercise=exercise, order=order, label=label)
    ExercisePartTranslation.objects.create(
        part=part, locale=locale, statement=statement, answer=answer, status='published'
    )
    return part


class PartsShapeTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch('parts-branch')
        self.exercise = make_exercise(self.branch, 1)
        self.other = make_exercise(self.branch, 2)
        self.a = make_part(self.exercise, 1, 'a', 'Policz \\((1-i)^2\\).', answer='\\(-2i\\)')
        self.b = make_part(self.exercise, 2, 'b', 'Policz \\(w^3\\).')
        ExercisePartTranslation.objects.create(
            part=self.b, locale='en', statement='Compute \\(w^3\\).', status='published'
        )
        self.foreign = make_part(self.other, 1, 'a', 'Elsewhere.')
        self.user = make_user('parts-user', is_staff=True)

    def test_the_detail_lists_parts_in_order_resolved_for_the_reader_with_fallback(self):
        pl = self.client.get(f'/api/exercises/{self.exercise.pk}/?lang=pl').data
        self.assertEqual([p['label'] for p in pl['parts']], ['a', 'b'])
        self.assertEqual(pl['parts'][0]['answer'], '\\(-2i\\)')
        self.assertEqual([p['resolved_locale'] for p in pl['parts']], ['pl', 'pl'])
        en = self.client.get(f'/api/exercises/{self.exercise.pk}/?lang=en').data
        self.assertEqual(en['parts'][0]['statement'], 'Policz \\((1-i)^2\\).')  # falls back
        self.assertEqual(en['parts'][1]['statement'], 'Compute \\(w^3\\).')
        self.assertEqual([p['resolved_locale'] for p in en['parts']], ['pl', 'en'])
        self.assertEqual(self.client.get(f'/api/exercises/{self.other.pk}/').data['parts'][0]['label'], 'a')
        plain = make_exercise(self.branch, 3)
        self.assertEqual(self.client.get(f'/api/exercises/{plain.pk}/').data['parts'], [])

    def test_an_entry_for_a_part_carries_it_and_a_foreign_part_is_refused(self):
        self.client.force_authenticate(self.user)
        url = f'/api/exercises/{self.exercise.pk}/entries/'
        refused = self.client.post(url, {'kind': 'hint', 'locale': 'pl', 'body': 'x', 'part': self.foreign.pk}, format='json')
        self.assertEqual(refused.status_code, status.HTTP_400_BAD_REQUEST, refused.data)
        self.assertEqual(refused.data['part'], ['part_not_of_exercise'])
        self.assertFalse(SolutionEntry.objects.filter(exercise=self.exercise).exists())
        whole = self.client.post(url, {'kind': 'hint', 'locale': 'pl', 'body': 'For all.'}, format='json')
        self.assertEqual(whole.status_code, status.HTTP_201_CREATED, whole.data)
        self.assertIsNone(whole.data['part'])
        for_b = self.client.post(url, {'kind': 'hint', 'locale': 'pl', 'body': 'Square first.', 'part': self.b.pk}, format='json')
        self.assertEqual(for_b.status_code, status.HTTP_201_CREATED, for_b.data)
        self.assertEqual(for_b.data['part'], self.b.pk)
        detail = self.client.get(f'/api/exercises/{self.exercise.pk}/').data
        self.assertEqual({e['body']: e['part'] for e in detail['entries']}, {'For all.': None, 'Square first.': self.b.pk})
        # Deleting the part takes its entries with it; the whole-exercise one stays.
        self.b.delete()
        self.assertEqual(list(SolutionEntry.objects.filter(exercise=self.exercise).values_list('body', flat=True)), ['For all.'])
