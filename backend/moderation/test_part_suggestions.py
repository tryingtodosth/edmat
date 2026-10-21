"""An edit suggestion against one PART of a set-shaped exercise (`EditSuggestion.part`,
`SUBEXERCISES-BRIEF.md` §2, §17CV.A): the refusals first (`part_and_entry`, `part_not_of_exercise`,
`part_field_invalid`, a language the exercise does not speak), then the happy path — it waits in
the queue with the part's label, and approving it writes the part's own translation row for its
locale, creating one (from the text that reader already saw) when the language had none."""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import ExercisePart, ExercisePartTranslation, ExerciseTranslation, SolutionEntry
from moderation.models import EditSuggestion
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user


def make_part(exercise, order, label, statement, *, answer='', locale='pl'):
    part = ExercisePart.objects.create(exercise=exercise, order=order, label=label)
    ExercisePartTranslation.objects.create(
        part=part, locale=locale, statement=statement, answer=answer, status='published'
    )
    return part


class PartSuggestionBase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch('part-sugg')
        self.exercise = make_exercise(self.branch, 1)
        ExerciseTranslation.objects.create(exercise=self.exercise, locale='en', title='E1', statement='Statement.', status='published')
        self.a = make_part(self.exercise, 1, 'a', 'Policz A.', answer='1')
        self.b = make_part(self.exercise, 2, 'b', 'Policz B.', answer='2')
        self.other = make_exercise(self.branch, 2)
        self.foreign = make_part(self.other, 1, 'a', 'Elsewhere.')
        self.reader = make_user('part-sugg-reader')
        self.staff = make_user('part-sugg-staff', is_staff=True)
        self.entry = SolutionEntry.objects.create(exercise=self.exercise, part=self.b, kind='hint', locale='pl', body='h', status='published')

    def suggest(self, body):
        self.client.force_authenticate(self.reader)
        return self.client.post('/api/edit-suggestions/', {'exercise': self.exercise.pk, 'locale': 'pl', 'proposed_value': 'Nowa treść.', **body}, format='json')


class PartSuggestionRefusalTests(PartSuggestionBase):
    def assert_refused(self, body, key, word):
        response = self.suggest(body)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertEqual(response.data[key], [word])
        self.assertFalse(EditSuggestion.objects.exists())

    def test_a_part_together_with_an_entry_is_refused(self):
        self.assert_refused({'part': self.b.pk, 'entry': self.entry.pk, 'field': 'statement'}, 'part', 'part_and_entry')

    def test_a_part_of_another_exercise_is_refused(self):
        self.assert_refused({'part': self.foreign.pk, 'field': 'statement'}, 'part', 'part_not_of_exercise')

    def test_a_part_has_no_title(self):
        self.assert_refused({'part': self.a.pk, 'field': 'title'}, 'field', 'part_field_invalid')
        self.assert_refused({'part': self.a.pk, 'field': 'body'}, 'field', 'part_field_invalid')

    def test_a_language_the_exercise_does_not_speak_is_still_refused(self):
        response = self.suggest({'part': self.a.pk, 'field': 'statement', 'locale': 'de'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertIn('locale', response.data)
        self.assertFalse(EditSuggestion.objects.exists())

    def test_the_entry_decide_path_does_not_decide_a_part_suggestion(self):
        created = self.suggest({'part': self.a.pk, 'field': 'statement'})
        self.client.force_authenticate(self.staff)
        response = self.client.post(f'/api/edit-suggestions/{created.data["id"]}/decide/', {'decision': 'approve'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(EditSuggestion.objects.get().status, 'pending')


class PartSuggestionApplyTests(PartSuggestionBase):
    def test_it_waits_in_the_queue_with_its_label_and_approving_writes_the_parts_row(self):
        created = self.suggest({'part': self.b.pk, 'field': 'statement', 'reason': 'typo'})
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        self.assertEqual((created.data['part'], created.data['part_label'], created.data['field']), (self.b.pk, 'b', 'statement'))
        self.client.force_authenticate(self.staff)
        queue = self.client.get('/api/moderation/queue/').data['edit_suggestions']
        row = next(r for r in queue if r['id'] == created.data['id'])
        self.assertEqual((row['part'], row['part_label']), (self.b.pk, 'b'))
        # A shared-statement suggestion reads as one: no part, no label.
        self.client.force_authenticate(self.reader)
        shared = self.client.post('/api/edit-suggestions/', {'exercise': self.exercise.pk, 'locale': 'pl', 'field': 'statement', 'proposed_value': 'x'}, format='json')
        self.assertEqual((shared.data['part'], shared.data['part_label']), (None, None))

        self.client.force_authenticate(self.staff)
        decided = self.client.post(f'/api/moderation/edit/{created.data["id"]}/approve/', {'review_note': 'ok'}, format='json')
        self.assertEqual(decided.status_code, status.HTTP_200_OK, decided.data)
        self.assertEqual(ExercisePartTranslation.objects.get(part=self.b, locale='pl', status='published').statement, 'Nowa treść.')
        self.assertEqual(ExercisePartTranslation.objects.get(part=self.a, locale='pl').statement, 'Policz A.')
        # The shared statement is untouched.
        self.assertEqual(ExerciseTranslation.objects.get(exercise=self.exercise, locale='pl').statement, 'Statement for exercise 1.')
        detail = self.client.get(f'/api/exercises/{self.exercise.pk}/?lang=pl').data
        self.assertEqual([p['statement'] for p in detail['parts']], ['Policz A.', 'Nowa treść.'])

    def test_approving_an_answer_in_a_language_the_part_lacks_creates_its_row_from_what_the_reader_saw(self):
        created = self.suggest({'part': self.a.pk, 'field': 'answer', 'locale': 'en', 'proposed_value': 'one'})
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        self.client.force_authenticate(self.staff)
        decided = self.client.post(f'/api/moderation/edit/{created.data["id"]}/approve/', {}, format='json')
        self.assertEqual(decided.status_code, status.HTTP_200_OK, decided.data)
        row = ExercisePartTranslation.objects.get(part=self.a, locale='en', status='published')
        self.assertEqual((row.statement, row.answer), ('Policz A.', 'one'))
        en = self.client.get(f'/api/exercises/{self.exercise.pk}/?lang=en').data['parts']
        self.assertEqual([(p['statement'], p['answer'], p['resolved_locale']) for p in en], [('Policz A.', 'one', 'en'), ('Policz B.', '2', 'pl')])
        # Rejecting one writes nothing.
        other = self.suggest({'part': self.b.pk, 'field': 'answer', 'proposed_value': 'zero'})
        self.client.force_authenticate(self.staff)
        self.client.post(f'/api/moderation/edit/{other.data["id"]}/reject/', {'review_note': 'no'}, format='json')
        self.assertEqual(ExercisePartTranslation.objects.get(part=self.b, locale='pl').answer, '2')
