"""Tests for `provenance` (`test.md`'s shape: the arithmetic first, then the refusals, then the
happy path).

**The formula first, with no database**, because `rules._derive` was written as a function over an
already-gathered row for exactly this reason: the thing that would be hardest to notice going wrong
is not "a vote was saved" but "the three-people icon lit on one person's opinion", and that is a
table of numbers, not a request.

**Then the refusals**, because almost every rule here is one: the author voting on their own work,
a stranger answering as the author, a minor's free text going live unread, a reader learning about
a comment that has been removed, and the kill switch. Each gets a test before the happy path does.
"""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment, Review
from exercises.models import SolutionEntry
from moderation.models import FeatureFlag, NodeGovernor
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user

from . import rules
from .models import AssistanceVote, AuthorMark, ScoreLock


class FormulaTests(APITestCase):
    """`rules._derive` as a table. No database and no HTTP — see this module's own docstring."""

    def row(self, **over):
        base = rules._blank('exercise', 1)
        base.update(over)
        return rules._derive(base)

    def test_no_votes_and_no_mark_reads_zero_and_lights_nothing(self):
        row = self.row()
        self.assertEqual(row['score'], 0)
        self.assertFalse(row['author_marked'])
        self.assertFalse(row['community_marked'])

    def test_one_confident_vote_does_not_light_the_community_mark(self):
        """The whole point of MIN_VOTES_FOR_COMMUNITY_MARK: a mean over one vote is one person's
        opinion wearing the word "community"."""
        row = self.row(votes=1, average_confidence=100)
        self.assertEqual(row['score'], 100)
        self.assertFalse(row['community_marked'])

    def test_enough_confident_votes_light_the_community_mark(self):
        row = self.row(votes=rules.MIN_VOTES_FOR_COMMUNITY_MARK, average_confidence=80)
        self.assertTrue(row['community_marked'])
        self.assertEqual(row['score'], 80)

    def test_enough_votes_but_not_confident_enough_lights_nothing(self):
        row = self.row(votes=rules.MIN_VOTES_FOR_COMMUNITY_MARK, average_confidence=20)
        self.assertFalse(row['community_marked'])
        self.assertEqual(row['score'], 20)

    def test_the_authors_own_mark_reads_one_hundred_whatever_the_votes_say(self):
        """"The author's mark is final; votes can only add the badge, never remove it" — the
        owner's own proposal of 2026-10-07."""
        row = self.row(author_marked=True, author_answered=True, votes=5, average_confidence=0)
        self.assertEqual(row['score'], 100)
        self.assertTrue(row['author_marked'])

    def test_an_authors_denial_does_not_pull_the_community_reading_down(self):
        """The mark is recorded and visible and a reader weighs both; a denial that silently erased
        every reader's reading would make the signal worthless on exactly the content it matters
        most on."""
        row = self.row(
            author_answered=True,
            author_marked=False,
            votes=rules.MIN_VOTES_FOR_COMMUNITY_MARK,
            average_confidence=90,
        )
        self.assertEqual(row['score'], 90)
        self.assertTrue(row['community_marked'])

    def test_a_lock_replaces_the_community_reading_and_keeps_the_authors_mark(self):
        row = self.row(
            locked=True,
            lock_value=0,
            lock_reason='the author showed us the drafts',
            author_marked=True,
            author_answered=True,
            votes=9,
            average_confidence=95,
        )
        self.assertEqual(row['score'], 0)
        self.assertFalse(row['community_marked'])
        # Never overwritten: it is a record of what a person said about their own work.
        self.assertTrue(row['author_marked'])


class ProvenanceTestCase(APITestCase):
    #: The telemetry log shards, like every other API test case: a request walks through the
    #: request-logging middleware, which writes to them.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.author = make_user('prov-author')
        self.reader = make_user('prov-reader')
        self.second = make_user('prov-second')
        self.third = make_user('prov-third')
        self.staff = make_user('prov-staff', is_staff=True)

        self.branch = make_branch('prov-branch')
        self.exercise = make_exercise(self.branch, 7101)
        self.exercise.submitted_by = self.author
        self.exercise.save(update_fields=['submitted_by'])

        self.entry = SolutionEntry.objects.create(
            exercise=self.exercise,
            kind='solution',
            locale='pl',
            body='bo tak',
            author=self.author,
            status='published',
        )
        self.review = Review.objects.create(exercise=self.exercise, author=self.reader, rating=4)
        self.comment = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(type(self.exercise)),
            object_id=self.exercise.pk,
            author=self.reader,
            body='a question',
        )
        FeatureFlag.objects.get_or_create(key='ai_assisted', defaults={'is_enabled': True})

    # ---- addresses ----

    def summary_url(self, targets):
        return f"{reverse('ai-assistance-summary')}?targets={targets}"

    def vote_url(self, kind, pk):
        return reverse('ai-assistance-vote', args=[kind, pk])

    def mark_url(self, kind, pk):
        return reverse('ai-assistance-author-mark', args=[kind, pk])

    def lock_url(self, kind, pk):
        return reverse('ai-assistance-lock', args=[kind, pk])

    # ---- refusals ----

    def test_the_author_may_not_vote_on_their_own_work_and_is_told_why(self):
        self.client.force_authenticate(self.author)
        response = self.client.put(
            self.vote_url('exercise', self.exercise.pk), {'confidence': 100}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        # House rule 6 — the refusal carries its reason, and the frontend has a line for it.
        self.assertEqual(response.data['detail'], 'author_marks_instead')

    def test_a_stranger_may_not_answer_as_the_author(self):
        self.client.force_authenticate(self.reader)
        response = self.client.put(
            self.mark_url('exercise', self.exercise.pk), {'assisted': True}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], 'not_the_author')

    def test_an_anonymous_visitor_may_read_but_not_vote(self):
        response = self.client.get(self.summary_url(f'exercise:{self.exercise.pk}'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        refused = self.client.put(
            self.vote_url('exercise', self.exercise.pk), {'confidence': 50}, format='json'
        )
        self.assertEqual(refused.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_confidence_outside_nought_to_a_hundred_is_a_four_hundred(self):
        self.client.force_authenticate(self.reader)
        for bad in (-1, 101):
            response = self.client.put(
                self.vote_url('exercise', self.exercise.pk), {'confidence': bad}, format='json'
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, bad)

    def test_a_lock_without_a_reason_is_refused(self):
        """House rule 6 in the one place it is a validation rule rather than a response field."""
        self.client.force_authenticate(self.staff)
        response = self.client.put(
            self.lock_url('exercise', self.exercise.pk), {'value': 0}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_ordinary_reader_may_not_lock(self):
        self.client.force_authenticate(self.reader)
        response = self.client.put(
            self.lock_url('exercise', self.exercise.pk),
            {'value': 0, 'reason': 'because'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_removed_comment_is_omitted_from_the_batch_rather_than_described(self):
        """House rule 4: for a reader it does not exist, so neither does anything hung on it."""
        self.comment.is_removed = True
        self.comment.save(update_fields=['is_removed'])
        self.client.force_authenticate(self.reader)
        response = self.client.get(self.summary_url(f'comment:{self.comment.pk}'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn(f'comment:{self.comment.pk}', response.data)

    def test_a_removed_comment_is_still_described_to_staff(self):
        self.comment.is_removed = True
        self.comment.save(update_fields=['is_removed'])
        self.client.force_authenticate(self.staff)
        response = self.client.get(self.summary_url(f'comment:{self.comment.pk}'))
        self.assertIn(f'comment:{self.comment.pk}', response.data)

    def test_an_unknown_kind_is_dropped_from_a_batch_and_four_oh_fours_on_a_write(self):
        self.client.force_authenticate(self.reader)
        batch = self.client.get(self.summary_url('venue:1,exercise:%d' % self.exercise.pk))
        self.assertEqual(batch.status_code, status.HTTP_200_OK)
        self.assertEqual(list(batch.data), [f'exercise:{self.exercise.pk}'])
        write = self.client.put(self.vote_url('venue', 1), {'confidence': 10}, format='json')
        self.assertEqual(write.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_kill_switch_closes_the_surface_to_everyone_but_staff(self):
        """House rule 3's backend half. The frontend takes the chip and the two menu items with it;
        this is the part that makes the endpoint itself vanish."""
        FeatureFlag.objects.filter(key='ai_assisted').update(is_enabled=False)
        self.client.force_authenticate(self.reader)
        self.assertEqual(
            self.client.get(self.summary_url(f'exercise:{self.exercise.pk}')).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.client.force_authenticate(self.staff)
        self.assertEqual(
            self.client.get(self.summary_url(f'exercise:{self.exercise.pk}')).status_code,
            status.HTTP_200_OK,
        )

    def test_a_minors_mark_counts_and_their_free_text_does_not(self):
        minor = make_user('prov-minor')
        minor.profile.is_minor = True
        minor.profile.save(update_fields=['is_minor'])
        entry = SolutionEntry.objects.create(
            exercise=self.exercise,
            kind='hint',
            locale='pl',
            body='spróbuj indukcji',
            author=minor,
            status='published',
        )
        self.client.force_authenticate(minor)
        response = self.client.put(
            self.mark_url('solution_entry', entry.pk),
            {'assisted': True, 'note': 'a sentence a moderator has not read'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['author_marked'])
        self.assertEqual(response.data['author_note'], '')

    # ---- the happy paths ----

    def test_a_vote_is_an_upsert_and_the_count_is_people_not_opinions(self):
        self.client.force_authenticate(self.reader)
        first = self.client.put(
            self.vote_url('exercise', self.exercise.pk), {'confidence': 10}, format='json'
        )
        self.assertEqual(first.data['votes'], 1)
        self.assertEqual(first.data['my_confidence'], 10)
        again = self.client.put(
            self.vote_url('exercise', self.exercise.pk), {'confidence': 90}, format='json'
        )
        self.assertEqual(again.data['votes'], 1)
        self.assertEqual(again.data['my_confidence'], 90)
        self.assertEqual(again.data['average_confidence'], 90)
        self.assertEqual(
            AssistanceVote.objects.filter(voter=self.reader, object_id=self.exercise.pk).count(), 1
        )

    def test_retracting_a_vote_leaves_the_target_with_none(self):
        self.client.force_authenticate(self.reader)
        self.client.put(
            self.vote_url('exercise', self.exercise.pk), {'confidence': 70}, format='json'
        )
        response = self.client.delete(self.vote_url('exercise', self.exercise.pk))
        self.assertEqual(response.data['votes'], 0)
        self.assertIsNone(response.data['my_confidence'])

    def test_three_readers_light_the_community_mark_on_a_solution(self):
        for user, confidence in ((self.reader, 80), (self.second, 90), (self.third, 70)):
            self.client.force_authenticate(user)
            response = self.client.put(
                self.vote_url('solution_entry', self.entry.pk),
                {'confidence': confidence},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['community_marked'])
        self.assertEqual(response.data['average_confidence'], 80)
        self.assertFalse(response.data['author_marked'])

    def test_the_author_mark_records_who_answered_and_at_which_version(self):
        self.client.force_authenticate(self.author)
        response = self.client.put(
            self.mark_url('solution_entry', self.entry.pk),
            {'assisted': True, 'note': 'the wording was tidied up'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['author_marked'])
        self.assertTrue(response.data['author_answered'])
        self.assertEqual(response.data['score'], 100)
        mark = AuthorMark.objects.get(object_id=self.entry.pk)
        self.assertEqual(mark.declared_by, self.author)
        self.assertTrue(mark.version_label)

    def test_the_author_saying_no_is_a_different_state_from_nobody_having_asked(self):
        self.client.force_authenticate(self.author)
        said_no = self.client.put(
            self.mark_url('solution_entry', self.entry.pk), {'assisted': False}, format='json'
        )
        self.assertTrue(said_no.data['author_answered'])
        self.assertFalse(said_no.data['author_marked'])
        withdrawn = self.client.delete(self.mark_url('solution_entry', self.entry.pk))
        self.assertFalse(withdrawn.data['author_answered'])
        self.assertFalse(withdrawn.data['author_marked'])

    def test_a_moderator_locks_the_reading_and_unlocks_it(self):
        # The three voters are deliberately NOT `self.reader`, who WROTE this review: the author of
        # a thing may not vote on it (`rules.can_vote`), and an earlier draft of this test proved
        # that by quietly getting a count of 2.
        for user, confidence in ((self.second, 90), (self.third, 90), (self.author, 90)):
            self.client.force_authenticate(user)
            self.client.put(
                self.vote_url('review', self.review.pk), {'confidence': confidence}, format='json'
            )
        self.client.force_authenticate(self.staff)
        locked = self.client.put(
            self.lock_url('review', self.review.pk),
            {'value': 0, 'reason': 'the author showed us the drafts'},
            format='json',
        )
        self.assertTrue(locked.data['locked'])
        self.assertEqual(locked.data['score'], 0)
        self.assertFalse(locked.data['community_marked'])
        self.assertEqual(locked.data['lock_reason'], 'the author showed us the drafts')
        # The votes are still there — a lock ends the argument, it does not erase who said what.
        self.assertEqual(locked.data['votes'], 3)
        unlocked = self.client.delete(self.lock_url('review', self.review.pk))
        self.assertFalse(unlocked.data['locked'])
        self.assertEqual(unlocked.data['score'], 90)
        self.assertFalse(ScoreLock.objects.filter(object_id=self.review.pk).exists())

    def test_a_branch_governor_may_lock_within_their_own_branch(self):
        """The same two-route authority `ReportActionView` applies to these same content kinds,
        asked through the same helper so the two surfaces cannot drift apart."""
        governor = make_user('prov-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(type(self.branch)),
            object_id=self.branch.pk,
            granted_by=self.staff,
        )
        self.client.force_authenticate(governor)
        response = self.client.put(
            self.lock_url('exercise', self.exercise.pk),
            {'value': 100, 'reason': 'reported and confirmed'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['locked'])

    def test_one_batch_answers_for_four_kinds_at_once(self):
        """The reason the four target kinds' own serializers in three apps were left alone: a page
        asks once for every chip it has just drawn."""
        self.client.force_authenticate(self.second)
        self.client.put(
            self.vote_url('comment', self.comment.pk), {'confidence': 60}, format='json'
        )
        targets = ','.join(
            [
                f'exercise:{self.exercise.pk}',
                f'solution_entry:{self.entry.pk}',
                f'comment:{self.comment.pk}',
                f'review:{self.review.pk}',
            ]
        )
        response = self.client.get(self.summary_url(targets))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 4)
        self.assertEqual(response.data[f'comment:{self.comment.pk}']['my_confidence'], 60)
        self.assertEqual(response.data[f'review:{self.review.pk}']['votes'], 0)

    def test_the_batch_says_what_this_reader_may_do_with_each_row(self):
        self.client.force_authenticate(self.author)
        targets = f'exercise:{self.exercise.pk},comment:{self.comment.pk}'
        data = self.client.get(self.summary_url(targets)).data
        own = data[f'exercise:{self.exercise.pk}']
        self.assertTrue(own['can_declare'])
        self.assertFalse(own['can_vote'])
        self.assertFalse(own['can_lock'])
        somebody_elses = data[f'comment:{self.comment.pk}']
        self.assertFalse(somebody_elses['can_declare'])
        self.assertTrue(somebody_elses['can_vote'])

    def test_the_batch_is_capped(self):
        """A crafted querystring cannot turn one request into a scan."""
        from .views import MAX_BATCH_TARGETS, _parse_targets

        self.assertEqual(
            len(_parse_targets(','.join(f'exercise:{n}' for n in range(MAX_BATCH_TARGETS + 50)))),
            MAX_BATCH_TARGETS,
        )
