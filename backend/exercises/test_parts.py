"""Sub-exercises (`SUBEXERCISES-BRIEF.md`, 2026-10-21): the parts of a set-shaped exercise, their
text resolved per language, and an entry that is for one part. The prep commit pinned the read
shape and the entry POST's `part` (`PartsShapeTests`); step A (§17CV.A) added the rest:

- `PartsVerifiedTests` — the derived flag for a set: whole solved / every part solved / one short,
  a part added or deleted recounts, an AI-assisted part solution counts only once reviewed;
- `PartsEditRefusalTests` — `PATCH /api/exercises/{id}/` `parts`: every refusal word, and nothing
  written when refused; the stranger is still `exercise_not_editor`;
- `PartsEditTests` — create, update, reorder, delete-with-entries, `[]`, the approved
  `EditSuggestion` record, the original-locale row only, verified following a deletion;
- `EntryPartTests` — an entry's `part` does not move on PATCH (`part_immutable`), and the pool's
  visibility and ordering are the same for a part entry as for any other;
- `PartsAdminTests` — the two changelists and change pages open for a superuser.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import (
    Exercise,
    ExercisePart,
    ExercisePartTranslation,
    ExerciseTranslation,
    SolutionEntry,
)
from moderation.models import EditSuggestion
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user, make_viewer


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


def solve(exercise, part=None, *, pinned=True, author=None, reviewed_by=None, status_='published'):
    """A solution that passes review by being pinned (the corpus shape) unless told otherwise."""
    return SolutionEntry.objects.create(
        exercise=exercise, part=part, kind='solution', locale='pl', body='Solution.',
        status=status_, pinned=pinned, author=author, reviewed_by=reviewed_by,
    )


class PartsVerifiedTests(APITestCase):
    """No endpoint: the recount is driven by the model signals, as every writer of it is."""

    def setUp(self):
        self.branch = make_branch('parts-verified')
        self.exercise = make_exercise(self.branch, 1)
        self.parts = [make_part(self.exercise, i, label, f'Part {label}.') for i, label in enumerate('abcd', start=1)]

    def verified(self):
        return Exercise.objects.get(pk=self.exercise.pk).verified

    def test_one_part_short_is_not_verified_and_a_hint_or_an_unreviewed_solution_does_not_count(self):
        for part in self.parts[:3]:
            solve(self.exercise, part)
        self.assertFalse(self.verified())
        SolutionEntry.objects.create(exercise=self.exercise, part=self.parts[3], kind='hint', locale='pl', body='h', status='published', pinned=True)
        self.assertFalse(self.verified())
        solve(self.exercise, self.parts[3], pinned=False, author=make_viewer('parts-plain'))
        self.assertFalse(self.verified())  # published, but nobody reviewed it and the author is not verified

    def test_every_part_solved_is_verified_and_losing_one_unverifies(self):
        entries = [solve(self.exercise, part) for part in self.parts]
        self.assertTrue(self.verified())
        entries[2].delete()
        self.assertFalse(self.verified())

    def test_a_solution_for_the_whole_verifies_a_set_with_no_part_solved(self):
        whole = solve(self.exercise)
        self.assertTrue(self.verified())
        whole.delete()
        self.assertFalse(self.verified())

    def test_a_part_added_to_a_verified_set_unverifies_it_and_deleting_it_verifies_it_again(self):
        for part in self.parts:
            solve(self.exercise, part)
        self.assertTrue(self.verified())
        extra = make_part(self.exercise, 5, 'e', 'Part e.')
        self.assertFalse(self.verified())
        extra.delete()
        self.assertTrue(self.verified())
        # Deleting a SOLVED part keeps it verified (the rest are still solved) …
        self.parts[0].delete()
        self.assertTrue(self.verified())
        # … and with every part gone and no whole solution there is nothing left to verify it.
        ExercisePart.objects.filter(exercise=self.exercise).delete()
        self.assertFalse(SolutionEntry.objects.filter(exercise=self.exercise).exists())
        self.assertFalse(self.verified())

    def test_an_ai_assisted_part_solution_counts_only_once_reviewed(self):
        from provenance.models import AuthorMark

        author = make_viewer('parts-ai')
        for part in self.parts[:3]:
            solve(self.exercise, part)
        last = solve(self.exercise, self.parts[3])
        self.assertTrue(self.verified())
        AuthorMark.objects.create(
            content_type=ContentType.objects.get_for_model(SolutionEntry), object_id=last.pk,
            assisted=True, declared_by=author,
        )
        self.assertFalse(self.verified())  # pinned, but machine-written and unreviewed
        reviewer = make_viewer('parts-ai-reviewer')
        last.reviewed_by = reviewer
        last.save(update_fields=['reviewed_by'])
        self.assertTrue(self.verified())

    def test_an_exercise_without_parts_behaves_exactly_as_before(self):
        plain = make_exercise(self.branch, 2)
        self.assertFalse(Exercise.objects.get(pk=plain.pk).verified)
        solve(plain)
        self.assertTrue(Exercise.objects.get(pk=plain.pk).verified)


class PartsEditBase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch('parts-edit')
        self.author = make_user('parts-edit-author')
        self.stranger = make_user('parts-edit-stranger')
        self.staff = make_user('parts-edit-staff', is_staff=True)
        self.exercise = make_exercise(self.branch, 1)
        Exercise.objects.filter(pk=self.exercise.pk).update(submitted_by=self.author)
        self.a = make_part(self.exercise, 1, 'a', 'Policz A.', answer='1')
        self.b = make_part(self.exercise, 2, 'b', 'Policz B.')
        self.other = make_exercise(self.branch, 2)
        self.foreign = make_part(self.other, 1, 'a', 'Elsewhere.')
        self.url = f'/api/exercises/{self.exercise.pk}/'

    def patch(self, user, body):
        self.client.force_authenticate(user)
        return self.client.patch(self.url, body, format='json')

    def item(self, part, **over):
        text = ExercisePartTranslation.objects.get(part=part, locale='pl', status='published')
        return {'id': part.pk, 'label': part.label, 'statement': text.statement, 'answer': text.answer, **over}

    def state(self):
        return [
            (p.order, p.label, p.translations.get(locale='pl', status='published').statement)
            for p in ExercisePart.objects.filter(exercise=self.exercise).order_by('order')
        ]


class PartsEditRefusalTests(PartsEditBase):
    def assert_refused(self, body, word, *, user=None):
        before = self.state()
        response = self.patch(user or self.author, body)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertEqual(response.data['parts'], [word])
        self.assertEqual(self.state(), before)
        self.assertFalse(EditSuggestion.objects.filter(part__exercise=self.exercise).exists())

    def test_a_part_of_another_exercise_is_refused(self):
        self.assert_refused({'parts': [self.item(self.a), self.item(self.foreign)]}, 'part_not_of_exercise')
        self.assert_refused({'parts': [{'id': 999999, 'label': 'z', 'statement': 'x'}]}, 'part_not_of_exercise')

    def test_two_items_with_the_same_label_are_refused(self):
        self.assert_refused({'parts': [self.item(self.a), self.item(self.b, label='a')]}, 'part_label_duplicate')
        self.assert_refused({'parts': [self.item(self.a), {'label': ' a ', 'statement': 'new'}]}, 'part_label_duplicate')

    def test_the_same_id_twice_is_refused(self):
        self.assert_refused({'parts': [self.item(self.a), self.item(self.a, label='c')]}, 'part_id_duplicate')

    def test_more_than_twenty_six_parts_are_refused(self):
        items = [{'label': f'p{i}', 'statement': f'S{i}'} for i in range(27)]
        self.assert_refused({'parts': items}, 'parts_too_many', user=self.staff)
        self.assertEqual(self.patch(self.staff, {'parts': items[:26]}).status_code, status.HTTP_200_OK)
        self.assertEqual(ExercisePart.objects.filter(exercise=self.exercise).count(), 26)

    def test_label_and_statement_are_required(self):
        before = self.state()
        for bad in ({'statement': 'x'}, {'label': 'c'}, {'label': '', 'statement': 'x'}, {'label': 'c', 'statement': ''}, {'label': 'x' * 21, 'statement': 'x'}):
            response = self.patch(self.author, {'parts': [self.item(self.a), bad]})
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, (bad, response.data))
            self.assertIn('parts', response.data)
        self.assertEqual(self.state(), before)

    def test_a_stranger_is_still_refused_as_not_an_editor_and_nothing_changes(self):
        before = self.state()
        response = self.patch(self.stranger, {'parts': []})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], 'exercise_not_editor')
        self.assertEqual(self.state(), before)


class PartsEditTests(PartsEditBase):
    def test_the_author_creates_updates_and_reorders_and_each_text_change_is_recorded(self):
        ExercisePartTranslation.objects.create(part=self.a, locale='en', statement='Compute A.', status='published')
        response = self.patch(self.author, {'parts': [
            self.item(self.b, label='(a)', statement='Policz B — poprawione.'),
            self.item(self.a, label='(b)'),
            {'label': '(c)', 'statement': 'Policz \\(z^3\\).', 'answer': '\\(-i\\)'},
        ]})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(
            [(p['label'], p['order'], p['statement']) for p in response.data['parts']],
            [('(a)', 1, 'Policz B — poprawione.'), ('(b)', 2, 'Policz A.'), ('(c)', 3, 'Policz \\(z^3\\).')],
        )
        self.assertEqual(response.data['parts'][2]['answer'], '\\(-i\\)')
        new = ExercisePart.objects.get(exercise=self.exercise, label='(c)')
        # The ids kept; only the original-locale row is written; the English one is untouched.
        self.assertEqual(ExercisePart.objects.get(pk=self.b.pk).order, 1)
        self.assertEqual(ExercisePartTranslation.objects.get(part=self.a, locale='en').statement, 'Compute A.')
        self.assertEqual(ExercisePartTranslation.objects.filter(part=self.b).count(), 1)
        records = {
            (s.part_id, s.field, s.proposed_value)
            for s in EditSuggestion.objects.filter(exercise=self.exercise)
        }
        self.assertEqual(records, {
            (self.b.pk, 'statement', 'Policz B — poprawione.'),
            (new.pk, 'statement', 'Policz \\(z^3\\).'),
            (new.pk, 'answer', '\\(-i\\)'),
        })
        for s in EditSuggestion.objects.filter(exercise=self.exercise):
            self.assertEqual((s.status, s.submitted_by, s.reviewed_by, s.locale), ('approved', self.author, self.author, 'pl'))
        # Sending the same list again changes nothing and records nothing.
        again = self.client.patch(self.url, {'parts': [
            {'id': p['id'], 'label': p['label'], 'statement': p['statement'], 'answer': p['answer']}
            for p in response.data['parts']
        ]}, format='json')
        self.assertEqual(again.status_code, status.HTTP_200_OK, again.data)
        self.assertEqual(EditSuggestion.objects.filter(exercise=self.exercise).count(), 3)

    def test_a_part_left_out_is_deleted_with_its_entries_and_suggestions(self):
        hint = SolutionEntry.objects.create(exercise=self.exercise, part=self.b, kind='hint', locale='pl', body='for b', status='published')
        whole = SolutionEntry.objects.create(exercise=self.exercise, kind='hint', locale='pl', body='for all', status='published')
        EditSuggestion.objects.create(exercise=self.exercise, part=self.b, locale='pl', field='statement', proposed_value='x', submitted_by=self.stranger)
        response = self.patch(self.staff, {'parts': [self.item(self.a)]})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual([p['label'] for p in response.data['parts']], ['a'])
        self.assertFalse(ExercisePart.objects.filter(pk=self.b.pk).exists())
        self.assertFalse(SolutionEntry.objects.filter(pk=hint.pk).exists())
        self.assertTrue(SolutionEntry.objects.filter(pk=whole.pk).exists())
        self.assertFalse(EditSuggestion.objects.filter(part_id=self.b.pk).exists())
        self.assertEqual([e['body'] for e in response.data['entries']], ['for all'])

    def test_an_empty_list_deletes_every_part_and_absent_leaves_them_alone(self):
        self.assertEqual(self.patch(self.author, {'difficulty': 'hard'}).status_code, status.HTTP_200_OK)
        self.assertEqual(len(self.state()), 2)
        response = self.patch(self.author, {'parts': []})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['parts'], [])
        self.assertFalse(ExercisePart.objects.filter(exercise=self.exercise).exists())
        # The shared statement is untouched by any of it.
        self.assertEqual(ExerciseTranslation.objects.get(exercise=self.exercise).statement, 'Statement for exercise 1.')

    def test_text_is_sanitized_and_verified_follows_a_deleted_unsolved_part(self):
        solve(self.exercise, self.a)
        self.assertFalse(Exercise.objects.get(pk=self.exercise.pk).verified)
        response = self.patch(self.author, {'parts': [self.item(self.a, statement='Policz <script>alert(1)</script>A.')]})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertNotIn('<script', response.data['parts'][0]['statement'])
        self.assertTrue(Exercise.objects.get(pk=self.exercise.pk).verified)
        self.assertTrue(response.data['verified'])
        # A new, unsolved part through the same PATCH unverifies it again.
        response = self.patch(self.author, {'parts': [self.item(self.a), {'label': 'b', 'statement': 'Nowe.'}]})
        self.assertFalse(response.data['verified'])


class EntryPartTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch('parts-entry')
        self.exercise = make_exercise(self.branch, 1)
        self.a = make_part(self.exercise, 1, 'a', 'A.')
        self.b = make_part(self.exercise, 2, 'b', 'B.')
        self.author = make_user('parts-entry-author')
        self.reviewer = make_user('parts-entry-reviewer', is_verified_contributor=True)
        self.stranger = make_user('parts-entry-stranger')

    def test_an_entry_does_not_move_between_parts_on_patch(self):
        self.client.force_authenticate(self.author)
        created = self.client.post(f'/api/exercises/{self.exercise.pk}/entries/', {'kind': 'hint', 'locale': 'pl', 'body': 'For a.', 'part': self.a.pk}, format='json')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        url = f'/api/solution-entries/{created.data["id"]}/'
        for moved in (self.b.pk, None):
            refused = self.client.patch(url, {'body': 'Moved.', 'part': moved}, format='json')
            self.assertEqual(refused.status_code, status.HTTP_400_BAD_REQUEST, refused.data)
            self.assertEqual(refused.data['part'], ['part_immutable'])
        entry = SolutionEntry.objects.get(pk=created.data['id'])
        self.assertEqual((entry.part_id, entry.body), (self.a.pk, 'For a.'))
        # Its own part again is not a move; no part at all is the ordinary edit.
        same = self.client.patch(url, {'body': 'Still for a.', 'part': self.a.pk}, format='json')
        self.assertEqual(same.status_code, status.HTTP_200_OK, same.data)
        plain = self.client.patch(url, {'body': 'Edited.'}, format='json')
        self.assertEqual(plain.status_code, status.HTTP_200_OK, plain.data)
        self.assertEqual(plain.data['part'], self.a.pk)
        # And a whole-exercise entry does not become a part's either.
        whole = SolutionEntry.objects.create(exercise=self.exercise, kind='hint', locale='pl', body='All.', author=self.author, status='published')
        refused = self.client.patch(f'/api/solution-entries/{whole.pk}/', {'part': self.b.pk}, format='json')
        self.assertEqual(refused.data['part'], ['part_immutable'])

    def test_a_pending_part_entry_is_seen_by_its_author_and_a_reviewer_only_and_ordering_is_the_pools(self):
        self.client.force_authenticate(self.author)
        pending = self.client.post(f'/api/exercises/{self.exercise.pk}/entries/', {'kind': 'solution', 'locale': 'pl', 'body': 'Pending for b.', 'part': self.b.pk}, format='json')
        self.assertEqual(pending.data['status'], 'pending')
        pinned = SolutionEntry.objects.create(exercise=self.exercise, part=self.a, kind='solution', locale='pl', body='Pinned for a.', status='published', pinned=True)
        whole = SolutionEntry.objects.create(exercise=self.exercise, kind='hint', locale='pl', body='Whole.', status='published')

        def bodies(user):
            self.client.force_authenticate(user)
            return [e['body'] for e in self.client.get(f'/api/exercises/{self.exercise.pk}/').data['entries']]

        # Pinned first, then score, then oldest — the pending one was written first.
        self.assertEqual(bodies(self.author), ['Pinned for a.', 'Pending for b.', 'Whole.'])
        self.assertEqual(bodies(self.reviewer), ['Pinned for a.', 'Pending for b.', 'Whole.'])
        self.assertEqual(bodies(self.stranger), ['Pinned for a.', 'Whole.'])
        self.assertEqual(bodies(None), ['Pinned for a.', 'Whole.'])
        # The reviewer accepts it through the pool's one review path, part and all.
        self.client.force_authenticate(self.reviewer)
        review = self.client.post(f'/api/solution-entries/{pending.data["id"]}/review/', {'decision': 'approve'}, format='json')
        self.assertEqual(review.status_code, status.HTTP_200_OK, review.data)
        self.assertEqual(bodies(self.stranger), ['Pinned for a.', 'Pending for b.', 'Whole.'])
        self.assertEqual(SolutionEntry.objects.get(pk=pending.data['id']).part_id, self.b.pk)
        self.assertEqual((pinned.part_id, whole.part_id), (self.a.pk, None))


class PartsAdminTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def test_the_part_pages_and_the_exercise_page_with_its_parts_inline_open(self):
        branch = make_branch('parts-admin')
        exercise = make_exercise(branch, 1)
        part = make_part(exercise, 1, 'a', 'A.')
        SolutionEntry.objects.create(exercise=exercise, part=part, kind='hint', locale='pl', body='h', status='published')
        EditSuggestion.objects.create(exercise=exercise, part=part, locale='pl', field='statement', proposed_value='x', submitted_by=make_viewer('parts-admin-s'))
        admin = make_user('parts-admin', is_staff=True, is_superuser=True)
        self.client.force_login(admin)
        for url in (
            '/admin/exercises/exercise/',
            f'/admin/exercises/exercise/{exercise.pk}/change/',
            '/admin/exercises/exercisepart/',
            f'/admin/exercises/exercisepart/{part.pk}/change/',
            '/admin/exercises/solutionentry/',
            '/admin/moderation/editsuggestion/',
        ):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200, url)
        page = self.client.get(f'/admin/exercises/exercise/{exercise.pk}/change/').content.decode()
        self.assertIn('exercise parts', page.lower())
