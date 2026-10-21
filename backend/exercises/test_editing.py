"""The in-place edit (`exercises/editing.py`, 2026-10-21): the author and staff edit, a stranger
does not — and the write hole this closed stays closed (any signed-in account could PATCH any
exercise before)."""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import Exercise, ExerciseTranslation, Tag
from moderation.models import EditSuggestion
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_topic, make_user


class ExerciseEditTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch('edit-branch')
        self.other_branch = make_branch('edit-other')
        self.topic = make_topic(self.branch, 'edit-topic')
        self.foreign_topic = make_topic(self.other_branch, 'edit-foreign')
        self.author = make_user('edit-author')
        self.stranger = make_user('edit-stranger')
        self.staff = make_user('edit-staff', is_staff=True)
        self.exercise = make_exercise(self.branch, 1, difficulty='easy')
        Exercise.objects.filter(pk=self.exercise.pk).update(submitted_by=self.author)
        self.url = f'/api/exercises/{self.exercise.pk}/'

    def patch(self, user, body):
        if user is not None:
            self.client.force_authenticate(user)
        return self.client.patch(self.url, body, format='json')

    def test_a_stranger_cannot_change_anything_and_is_told_why(self):
        response = self.patch(self.stranger, {'difficulty': 'hard', 'statement': 'hacked'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], 'exercise_not_editor')
        self.exercise.refresh_from_db()
        self.assertEqual(self.exercise.difficulty, 'easy')
        self.assertEqual(ExerciseTranslation.objects.get(exercise=self.exercise).statement, 'Statement for exercise 1.')
        self.assertEqual(self.client.patch(self.url, {'difficulty': 'hard'}, format='json').status_code, status.HTTP_403_FORBIDDEN)  # still the stranger
        self.client.force_authenticate(None)
        self.assertEqual(self.client.patch(self.url, {'difficulty': 'hard'}, format='json').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_put_and_delete_are_gone(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.put(self.url, {'difficulty': 'hard'}, format='json').status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertTrue(Exercise.objects.filter(pk=self.exercise.pk).exists())

    def test_the_author_edits_text_and_structure_and_the_text_change_is_recorded(self):
        response = self.patch(self.author, {
            'title': 'New title',
            'statement': 'New statement \\(x^2\\).',
            'difficulty': 'hard',
            'audience': 'secondary',
            'topic_ids': [self.topic.pk],
            'tags': ['Liczby zespolone', 'liczby-zespolone', '', 'algebra'],
            'source': {'type': 'exam', 'name': 'Egzamin 2026', 'pages': '3'},
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['title'], 'New title')
        self.assertEqual(response.data['difficulty'], 'hard')
        self.assertEqual(response.data['audience'], 'secondary')
        self.assertEqual(response.data['topics'], [self.topic.pk])
        self.assertEqual(response.data['tags'], ['liczby-zespolone', 'algebra'])
        self.assertEqual(response.data['source']['type'], 'exam')
        self.assertEqual(response.data['source']['name'], 'Egzamin 2026')
        self.assertTrue(response.data['can_edit'])
        rows = EditSuggestion.objects.filter(exercise=self.exercise).order_by('field')
        self.assertEqual([(r.field, r.status, r.submitted_by, r.reviewed_by) for r in rows],
                         [('statement', 'approved', self.author, self.author), ('title', 'approved', self.author, self.author)])
        self.assertTrue(Tag.objects.filter(slug='algebra').exists())
        # an unchanged field sent again records nothing
        self.patch(self.author, {'title': 'New title'})
        self.assertEqual(EditSuggestion.objects.filter(exercise=self.exercise).count(), 2)

    def test_staff_edit_and_the_detail_says_who_may(self):
        self.client.force_authenticate(self.stranger)
        self.assertFalse(self.client.get(self.url).data['can_edit'])
        self.client.force_authenticate(self.author)
        self.assertTrue(self.client.get(self.url).data['can_edit'])
        self.client.force_authenticate(None)
        self.assertFalse(self.client.get(self.url).data['can_edit'])
        response = self.patch(self.staff, {'answer': '42'})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['answer'], '42')
        self.assertEqual(EditSuggestion.objects.get(exercise=self.exercise).submitted_by, self.staff)

    def test_a_topic_of_another_branch_and_a_bad_difficulty_are_refused(self):
        response = self.patch(self.author, {'topic_ids': [self.foreign_topic.pk]})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('topics_not_in_branch', str(response.data['topic_ids']))
        response = self.patch(self.author, {'difficulty': 'impossible'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.exercise.refresh_from_db()
        self.assertEqual(self.exercise.difficulty, 'easy')
