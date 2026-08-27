"""The solution/hint pool (SolutionEntry — CLAUDE.md's peer-solutions feature, 2026-08-27).

Weighted, like every suite here, toward the boundaries that fail silently: who may publish without
review, who may review, what a pending entry leaks to whom, the derived `Exercise.verified`, the
one-accept/one-deny rules, entry-targeted edit suggestions' own deciding circle, and the report/
auto-hide wiring. Its own module (not `tests.py`) purely for size, the same split
`booking/test_week_schedules.py` already made.
"""

from django.contrib.contenttypes.models import ContentType
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment
from telemetry.routers import all_log_shards
from moderation.models import ContentView, EditSuggestion, Report
from notifications.models import Notification
from testing.factories import make_branch, make_exercise, make_user, make_viewer

from .models import Exercise, SolutionEntry, SolutionEntryVote


def make_entry(exercise, *, kind='solution', locale='pl', body='<p>Because \\(x=2\\).</p>',
               author=None, status='published', pinned=False, reviewed_by=None):
    return SolutionEntry.objects.create(
        exercise=exercise, kind=kind, locale=locale, body=body, author=author,
        status=status, pinned=pinned, reviewed_by=reviewed_by,
    )


class EntryCreationTests(APITestCase):
    def setUp(self):
        self.branch = make_branch(slug='pool-create')
        self.exercise = make_exercise(self.branch, 1)

    def _post(self, user, **overrides):
        self.client.force_authenticate(user)
        data = {'kind': 'solution', 'locale': 'pl', 'body': '<p>My way.</p>', **overrides}
        return self.client.post(f'/api/exercises/{self.exercise.pk}/entries/', data, format='json')

    def test_anonymous_cannot_add(self):
        response = self.client.post(
            f'/api/exercises/{self.exercise.pk}/entries/',
            {'kind': 'hint', 'locale': 'pl', 'body': 'x'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_plain_user_starts_pending(self):
        response = self._post(make_user('pool-plain'))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], 'pending')

    def test_a_verified_contributor_publishes_immediately_but_unpinned(self):
        response = self._post(make_user('pool-vc', is_verified_contributor=True))
        self.assertEqual(response.data['status'], 'published')
        self.assertFalse(response.data['pinned'])

    def test_a_blank_body_is_refused(self):
        response = self._post(make_user('pool-blank'), body='   ')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class EntryVisibilityTests(APITestCase):
    """What GET /api/exercises/{id}/ embeds, per caller — a pending entry must reach exactly its
    author and the reviewer circle, and nobody else."""

    def setUp(self):
        self.branch = make_branch(slug='pool-vis')
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('pool-author')
        self.pending = make_entry(self.exercise, author=self.author, status='pending')
        self.published = make_entry(self.exercise, body='<p>Public.</p>')

    def _entry_ids(self):
        response = self.client.get(f'/api/exercises/{self.exercise.pk}/')
        return {e['id'] for e in response.data['entries']}

    def test_anonymous_sees_published_only(self):
        self.assertEqual(self._entry_ids(), {self.published.pk})

    def test_the_author_sees_their_own_pending(self):
        self.client.force_authenticate(self.author)
        self.assertIn(self.pending.pk, self._entry_ids())

    def test_a_stranger_does_not_see_it(self):
        self.client.force_authenticate(make_user('pool-stranger'))
        self.assertEqual(self._entry_ids(), {self.published.pk})

    def test_a_verified_contributor_sees_it(self):
        self.client.force_authenticate(make_user('pool-reviewer', is_verified_contributor=True))
        self.assertIn(self.pending.pk, self._entry_ids())

    def test_a_rejected_entry_is_visible_to_its_author_only(self):
        rejected = make_entry(self.exercise, author=self.author, status='rejected')
        self.client.force_authenticate(self.author)
        self.assertIn(rejected.pk, self._entry_ids())
        self.client.force_authenticate(make_user('pool-other'))
        self.assertNotIn(rejected.pk, self._entry_ids())

    def test_pinned_sorts_first_regardless_of_votes(self):
        pinned = make_entry(self.exercise, body='<p>Original.</p>', pinned=True)
        voter = make_user('pool-voter')
        SolutionEntryVote.objects.create(entry=self.published, voter=voter, value=1)
        response = self.client.get(f'/api/exercises/{self.exercise.pk}/')
        ids = [e['id'] for e in response.data['entries']]
        self.assertEqual(ids[0], pinned.pk)


class EntryReviewTests(APITestCase):
    def setUp(self):
        self.branch = make_branch(slug='pool-review')
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('rev-author')
        self.entry = make_entry(self.exercise, author=self.author, status='pending')
        self.reviewer = make_user('rev-vc', is_verified_contributor=True)

    def _review(self, user, decision, note=''):
        self.client.force_authenticate(user)
        return self.client.post(
            f'/api/solution-entries/{self.entry.pk}/review/',
            {'decision': decision, 'note': note},
            format='json',
        )

    def test_one_verified_accept_publishes_and_notifies(self):
        response = self._review(self.reviewer, 'approve')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.status, 'published')
        self.assertEqual(self.entry.reviewed_by, self.reviewer)
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.author, type='solution_entry_approved'
            ).exists()
        )

    def test_a_plain_user_may_not_review(self):
        response = self._review(make_user('rev-plain'), 'approve')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_rejection_requires_a_note(self):
        response = self._review(self.reviewer, 'reject')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_rejection_with_a_note_lands_and_notifies(self):
        response = self._review(self.reviewer, 'reject', note='The sign flips in step 2.')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.status, 'rejected')
        notification = Notification.objects.get(
            recipient=self.author, type='solution_entry_rejected'
        )
        self.assertEqual(notification.note, 'The sign flips in step 2.')

    def test_a_second_decision_is_a_clean_409(self):
        self._review(self.reviewer, 'approve')
        response = self._review(make_user('rev-vc2', is_verified_contributor=True), 'approve')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)


class DerivedVerifiedTests(APITestCase):
    """Exercise.verified is derived now (signals.recount_verified) — at least one published,
    visible solution that passed review (pinned, reviewed, or by a verified contributor)."""

    def setUp(self):
        self.branch = make_branch(slug='pool-verified')
        self.exercise = make_exercise(self.branch, 1)

    def _verified(self):
        return Exercise.objects.get(pk=self.exercise.pk).verified

    def test_starts_false_with_no_solutions(self):
        self.assertFalse(self._verified())

    def test_an_accepted_solution_makes_it_true(self):
        entry = make_entry(self.exercise, author=make_user('dv-author'), status='pending')
        reviewer = make_user('dv-vc', is_verified_contributor=True)
        self.client.force_authenticate(reviewer)
        self.client.post(
            f'/api/solution-entries/{entry.pk}/review/', {'decision': 'approve'}, format='json'
        )
        self.assertTrue(self._verified())

    def test_a_hint_never_counts(self):
        make_entry(self.exercise, kind='hint', pinned=True)
        self.assertFalse(self._verified())

    def test_an_unreviewed_published_solution_does_not_count(self):
        # Published (a verified author's fast path) but author isn't verified and nothing pinned
        # or reviewed it — the migration/backfill shape can't produce this, but the DB can.
        make_entry(self.exercise, author=make_user('dv-plain'))
        self.assertFalse(self._verified())

    def test_a_verified_authors_solution_counts(self):
        make_entry(self.exercise, author=make_user('dv-vc2', is_verified_contributor=True))
        self.assertTrue(self._verified())

    def test_deleting_the_only_qualifying_solution_clears_it(self):
        entry = make_entry(self.exercise, pinned=True)
        self.assertTrue(self._verified())
        entry.delete()
        self.assertFalse(self._verified())


class EntryVoteTests(APITestCase):
    def setUp(self):
        self.branch = make_branch(slug='pool-votes')
        self.exercise = make_exercise(self.branch, 1)
        self.entry = make_entry(self.exercise)

    def _vote(self, user, value):
        self.client.force_authenticate(user)
        return self.client.post(
            f'/api/solution-entries/{self.entry.pk}/vote/', {'value': value}, format='json'
        )

    def test_votes_are_weighted(self):
        self._vote(make_user('vote-plain'), 1)
        response = self._vote(make_user('vote-vc', is_verified_contributor=True), 1)
        summary = response.data['vote_summary']
        self.assertEqual(summary['agree_count'], 2)
        self.assertEqual(summary['net_weight'], 3)  # 1 + 2

    def test_revoting_replaces_rather_than_duplicates(self):
        user = make_user('vote-flip')
        self._vote(user, 1)
        response = self._vote(user, -1)
        self.assertEqual(response.data['vote_summary']['net_weight'], -1)
        self.assertEqual(SolutionEntryVote.objects.filter(entry=self.entry).count(), 1)

    def test_retracting_removes_the_vote(self):
        user = make_user('vote-retract')
        self._vote(user, 1)
        self.client.delete(f'/api/solution-entries/{self.entry.pk}/vote/')
        self.assertEqual(SolutionEntryVote.objects.filter(entry=self.entry).count(), 0)

    def test_a_pending_entry_cannot_be_voted_on(self):
        self.entry.status = 'pending'
        self.entry.save(update_fields=['status'])
        response = self._vote(make_user('vote-early'), 1)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)


class EntryPinAndOwnerEditTests(APITestCase):
    def setUp(self):
        self.branch = make_branch(slug='pool-own')
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('own-author')
        self.entry = make_entry(self.exercise, author=self.author)

    def test_pinning_is_staff_or_governor_only(self):
        self.client.force_authenticate(self.author)
        response = self.client.post(
            f'/api/solution-entries/{self.entry.pk}/pin/', {'pinned': True}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(make_user('own-staff', is_staff=True))
        response = self.client.post(
            f'/api/solution-entries/{self.entry.pk}/pin/', {'pinned': True}, format='json'
        )
        self.assertTrue(response.data['pinned'])
        # Pinning a published solution also flips the derived verified flag.
        self.assertTrue(Exercise.objects.get(pk=self.exercise.pk).verified)

    def test_a_non_verified_authors_edit_requeues(self):
        self.client.force_authenticate(self.author)
        response = self.client.patch(
            f'/api/solution-entries/{self.entry.pk}/', {'body': '<p>Better.</p>'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'pending')

    def test_a_stranger_cannot_edit_or_delete(self):
        self.client.force_authenticate(make_user('own-stranger'))
        self.assertEqual(
            self.client.patch(
                f'/api/solution-entries/{self.entry.pk}/', {'body': 'x'}, format='json'
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.delete(f'/api/solution-entries/{self.entry.pk}/').status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_the_author_can_delete_their_own(self):
        self.client.force_authenticate(self.author)
        response = self.client.delete(f'/api/solution-entries/{self.entry.pk}/')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(SolutionEntry.objects.filter(pk=self.entry.pk).exists())


class EntryEditSuggestionTests(APITestCase):
    """A suggestion against an entry names the ROW; its deciding circle is the entry's author +
    staff/governors — not every verified contributor, and never through the translation fields."""

    def setUp(self):
        self.branch = make_branch(slug='pool-suggest')
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('sug-author')
        self.entry = make_entry(self.exercise, author=self.author)
        self.suggester = make_user('sug-suggester')

    def _suggest(self):
        self.client.force_authenticate(self.suggester)
        return self.client.post(
            '/api/edit-suggestions/',
            {'entry': self.entry.pk, 'proposed_value': '<p>Clearer.</p>', 'reason': 'typo'},
            format='json',
        )

    def test_positional_fields_derive_from_the_entry(self):
        response = self._suggest()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['field'], 'body')
        self.assertEqual(response.data['exercise'], self.exercise.pk)
        self.assertEqual(response.data['locale'], self.entry.locale)

    def test_a_pending_entry_takes_no_suggestions(self):
        self.entry.status = 'pending'
        self.entry.save(update_fields=['status'])
        self.assertEqual(self._suggest().status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_old_hint_solution_translation_fields_are_refused(self):
        self.client.force_authenticate(self.suggester)
        response = self.client.post(
            '/api/edit-suggestions/',
            {
                'exercise': self.exercise.pk,
                'locale': 'pl',
                'field': 'solution',
                'proposed_value': 'x',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_author_decides_and_an_approval_mutates_the_body(self):
        suggestion_id = self._suggest().data['id']
        self.client.force_authenticate(self.author)
        response = self.client.post(
            f'/api/edit-suggestions/{suggestion_id}/decide/', {'decision': 'approve'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.body, '<p>Clearer.</p>')
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.suggester, type='edit_suggestion_approved'
            ).exists()
        )

    def test_a_verified_contributor_is_not_in_the_deciding_circle(self):
        suggestion_id = self._suggest().data['id']
        self.client.force_authenticate(make_user('sug-vc', is_verified_contributor=True))
        response = self.client.post(
            f'/api/edit-suggestions/{suggestion_id}/decide/', {'decision': 'approve'}, format='json'
        )
        # 404, not 403: a non-staff caller's queryset never contains somebody else's suggestion
        # against somebody else's entry — the same scoping-not-permission convention as elsewhere.
        self.assertIn(
            response.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)
        )
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.body, '<p>Because \\(x=2\\).</p>')

    def test_a_translation_suggestion_is_not_decided_here(self):
        self.client.force_authenticate(self.suggester)
        created = self.client.post(
            '/api/edit-suggestions/',
            {
                'exercise': self.exercise.pk,
                'locale': 'pl',
                'field': 'statement',
                'proposed_value': 'Better statement.',
            },
            format='json',
        )
        self.client.force_authenticate(make_user('sug-staff', is_staff=True))
        response = self.client.post(
            f"/api/edit-suggestions/{created.data['id']}/decide/",
            {'decision': 'approve'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class EntryDiscussionTests(APITestCase):
    def setUp(self):
        self.branch = make_branch(slug='pool-talk')
        self.exercise = make_exercise(self.branch, 1)
        self.entry = make_entry(self.exercise)
        self.other_entry = make_entry(self.exercise, body='<p>Another.</p>')
        self.user = make_user('talk-user')

    def test_an_entry_has_its_own_thread(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            f'/api/solution-entries/{self.entry.pk}/comments/',
            {'body': 'Why does step 2 hold?'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        listed = self.client.get(f'/api/solution-entries/{self.entry.pk}/comments/')
        self.assertEqual(len(listed.data), 1)

    def test_a_parent_from_another_entrys_thread_is_refused(self):
        content_type = ContentType.objects.get_for_model(SolutionEntry)
        foreign = Comment.objects.create(
            content_type=content_type,
            object_id=self.other_entry.pk,
            author=self.user,
            body='Elsewhere.',
        )
        self.client.force_authenticate(self.user)
        response = self.client.post(
            f'/api/solution-entries/{self.entry.pk}/comments/',
            {'body': 'Reply.', 'parent': foreign.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class EntryReportTests(APITestCase):
    def setUp(self):
        self.branch = make_branch(slug='pool-report')
        self.exercise = make_exercise(self.branch, 1)
        self.entry = make_entry(self.exercise)

    def test_an_entry_is_reportable_and_auto_hides_against_the_exercises_viewer_pool(self):
        # 10 recorded viewers of the exercise; 3 distinct reports = 30% >= 20% and >= the floor.
        for i in range(10):
            ContentView.objects.create(user=make_viewer(f'rep-view-{i}'), exercise=self.exercise)
        for i in range(3):
            self.client.force_authenticate(make_user(f'rep-user-{i}'))
            response = self.client.post(
                '/api/reports/',
                {'kind': 'solution_entry', 'object_id': self.entry.pk, 'reason': 'wrong'},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.entry.refresh_from_db()
        self.assertIsNotNone(self.entry.auto_hidden_at)
        self.assertEqual(
            Report.objects.filter(status='pending').count(), 3
        )
        # And the hidden entry leaves the reader-facing list.
        self.client.force_authenticate(None)
        detail = self.client.get(f'/api/exercises/{self.exercise.pk}/')
        self.assertEqual(detail.data['entries'], [])


class SubmissionCreatesEntriesTests(APITestCase):
    """`_apply_submission` turns the form's hint/solution into founding pool entries — pinned when
    a moderator approved, unpinned on the verified fast path (nobody reviewed it)."""

    # The submission endpoint's request path writes telemetry to the log shards.
    databases = set(all_log_shards()) | {'default'}

    def test_verified_fast_path_publishes_unpinned_entries(self):
        branch = make_branch(slug='pool-sub')
        contributor = make_user('sub-vc', is_verified_contributor=True)
        self.client.force_authenticate(contributor)
        response = self.client.post(
            '/api/exercise-submissions/',
            {
                'branch': branch.slug,
                'payload': {
                    'title': 'New one',
                    'statement': '<p>Prove it.</p>',
                    'hint': '<p>Try induction.</p>',
                    'solution': '<p>Induction works.</p>',
                    'locale': 'pl',
                    'difficulty': 'easy',
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        exercise = Exercise.objects.get(pk=response.data['resulting_exercise'])
        entries = {e.kind: e for e in exercise.entries.all()}
        self.assertEqual(set(entries), {'hint', 'solution'})
        self.assertFalse(entries['solution'].pinned)
        self.assertEqual(entries['solution'].status, 'published')
        self.assertEqual(entries['solution'].author, contributor)
        # A verified author's published solution passes review by authorship → derived verified.
        self.assertTrue(exercise.verified)


class SiteActivityTests(APITestCase):
    def test_the_feed_lists_new_entries_and_exercises(self):
        branch = make_branch(slug='pool-activity')
        exercise = make_exercise(branch, 1)
        make_entry(exercise, author=make_user('act-author', is_verified_contributor=True))
        response = self.client.get('/api/activity/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kinds = {item['kind'] for item in response.data}
        self.assertIn('exercise', kinds)
        self.assertIn('solution_entry', kinds)
