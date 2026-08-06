"""Part of this project's automated test suite (CLAUDE.md Section 17L)."""

import time

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment
from exercises.models import Tag
from materials.models import (
    MaterialCoverage,
    MaterialCoverageVote,
    MaterialRequirement,
    MaterialRequirementVote,
    MaterialReview,
    MaterialView,
)
from materials.services import get_recommended_materials
from moderation.models import NodeGovernor
from taxonomy.models import Branch
from testing.factories import make_course, make_exercise, make_material, make_topic, make_user


class MaterialListingTests(APITestCase):
    def setUp(self):
        self.branch = make_course()
        self.material = make_material(
            self.branch, 'skrypt', title='Branch script', description='The full lecture script.'
        )

    def test_course_materials_lists_published_materials(self):
        response = self.client.get(reverse('branch-materials', kwargs={'slug': self.branch.slug}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['slug'], 'skrypt')

    def test_search_matches_on_title(self):
        make_material(self.branch, 'exam-collection', title='Exam collection', description='Past exams.')

        response = self.client.get(reverse('material-list'), {'q': 'exam'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'exam-collection'})

    def test_search_matches_on_description_too(self):
        response = self.client.get(reverse('material-list'), {'q': 'lecture script'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'skrypt'})

    def test_submitted_by_display_name_is_null_when_there_is_no_real_submitter(self):
        """The legacy corpus's own materials (imported with no submitter) must never show a
        fabricated name — `None`, not an empty string, so the frontend can tell "no real submitter"
        apart from "a submitter with a genuinely blank display name.\""""
        response = self.client.get(reverse('material-detail', kwargs={'pk': self.material.pk}))

        self.assertIsNone(response.data['submitted_by'])
        self.assertIsNone(response.data['submitted_by_display_name'])

    def test_submitted_by_display_name_resolves_a_real_submitters_own_name(self):
        submitter = make_user('material-submitter-display-name')
        submitter.profile.display_name = 'Real Submitter Name'
        submitter.profile.save(update_fields=['display_name'])
        self.material.submitted_by = submitter
        self.material.save(update_fields=['submitted_by'])

        response = self.client.get(reverse('material-detail', kwargs={'pk': self.material.pk}))

        self.assertEqual(response.data['submitted_by'], submitter.pk)
        self.assertEqual(response.data['submitted_by_display_name'], 'Real Submitter Name')


class MaterialCoverageProposalTests(APITestCase):
    def setUp(self):
        self.branch = make_course()
        self.other_course = make_course(slug='uw-other-branch')
        self.material = make_material(self.branch, 'skrypt')
        self.topic = make_topic(self.branch)
        self.user = make_user('proposer')
        self.client.force_authenticate(self.user)

    def test_proposing_coverage_succeeds(self):
        response = self.client.post(
            reverse('material-coverage', kwargs={'pk': self.material.pk}),
            {'topic': self.topic.pk, 'level': 80},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        coverage = MaterialCoverage.objects.get(material=self.material, topic=self.topic)
        self.assertEqual(coverage.level, 80)
        self.assertEqual(coverage.proposed_by, self.user)

    def test_proposing_a_duplicate_topic_pairing_is_rejected(self):
        MaterialCoverage.objects.create(material=self.material, topic=self.topic, level=50, proposed_by=self.user)

        response = self.client.post(
            reverse('material-coverage', kwargs={'pk': self.material.pk}),
            {'topic': self.topic.pk, 'level': 90},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(MaterialCoverage.objects.filter(material=self.material, topic=self.topic).count(), 1)

    def test_a_topic_from_a_different_course_is_rejected(self):
        foreign_topic = make_topic(self.other_course, slug='foreign-topic')

        response = self.client.post(
            reverse('material-coverage', kwargs={'pk': self.material.pk}),
            {'topic': foreign_topic.pk, 'level': 50},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_anonymous_user_cannot_propose_coverage(self):
        self.client.force_authenticate(None)

        response = self.client.post(
            reverse('material-coverage', kwargs={'pk': self.material.pk}),
            {'topic': self.topic.pk, 'level': 50},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class MaterialCoverageVoteTests(APITestCase):
    def setUp(self):
        self.branch = make_course()
        self.material = make_material(self.branch, 'skrypt')
        self.topic = make_topic(self.branch)
        self.coverage = MaterialCoverage.objects.create(
            material=self.material, topic=self.topic, level=70, proposed_by=make_user('proposer2')
        )

    def _vote(self, user, value):
        self.client.force_authenticate(user)
        return self.client.post(
            reverse('material-coverage-vote', kwargs={'pk': self.coverage.pk}), {'value': value}, format='json'
        )

    def test_agree_and_disagree_counts_are_computed_correctly(self):
        self._vote(make_user('voter1'), 1)
        self._vote(make_user('voter2'), 1)
        response = self._vote(make_user('voter3'), -1)

        summary = response.data['vote_summary']
        self.assertEqual(summary['agree_count'], 2)
        self.assertEqual(summary['disagree_count'], 1)
        self.assertEqual(summary['net_weight'], 1)  # 2 agree - 1 disagree, all plain 1x voters

    def test_a_verified_contributors_vote_counts_double(self):
        contributor = make_user('vip', is_verified_contributor=True)
        response = self._vote(contributor, 1)

        summary = response.data['vote_summary']
        self.assertEqual(summary['agree_count'], 1)
        self.assertEqual(summary['agree_weight'], 2)

    def test_revoting_updates_the_existing_vote_rather_than_duplicating_it(self):
        voter = make_user('flip-flopper')
        self._vote(voter, 1)

        response = self._vote(voter, -1)

        self.assertEqual(MaterialCoverageVote.objects.filter(coverage=self.coverage, voter=voter).count(), 1)
        self.assertEqual(response.data['vote_summary']['agree_count'], 0)
        self.assertEqual(response.data['vote_summary']['disagree_count'], 1)

    def test_deleting_a_vote_removes_it(self):
        voter = make_user('remover')
        self._vote(voter, 1)

        response = self.client.delete(reverse('material-coverage-vote', kwargs={'pk': self.coverage.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(MaterialCoverageVote.objects.filter(coverage=self.coverage, voter=voter).exists())


class MaterialCoverageCommentTests(APITestCase):
    def test_authenticated_user_can_comment_on_a_coverage_claim(self):
        branch = make_course()
        material = make_material(branch, 'skrypt')
        topic = make_topic(branch)
        coverage = MaterialCoverage.objects.create(
            material=material, topic=topic, level=60, proposed_by=make_user('proposer3')
        )
        self.client.force_authenticate(make_user('commenter'))

        response = self.client.post(
            reverse('material-coverage-comments', kwargs={'pk': coverage.pk}),
            {'body': 'This level seems too high.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class MaterialFilterSortTests(APITestCase):
    """The search/filter/sort overhaul's own structured query params (`type`, `topic_id`,
    `min_level`, `sort`) — none of these had any real test coverage before this class."""

    def setUp(self):
        self.branch = make_course()
        self.topic = make_topic(self.branch)
        self.other_topic = make_topic(self.branch, slug='other-topic')

        self.script = make_material(self.branch, 'skrypt', type='script', title='Branch script')
        self.exam = make_material(
            self.branch, 'exam-set', type='exam_collection', title='Exam set'
        )

        MaterialCoverage.objects.create(material=self.script, topic=self.topic, level=90)
        MaterialCoverage.objects.create(material=self.exam, topic=self.topic, level=30)
        MaterialCoverage.objects.create(material=self.exam, topic=self.other_topic, level=95)

    def test_type_filter(self):
        response = self.client.get(reverse('material-list'), {'type': 'exam_collection'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'exam-set'})

    def test_topic_id_filter(self):
        response = self.client.get(reverse('material-list'), {'topic_id': self.other_topic.pk})

        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'exam-set'})

    def test_topic_id_with_min_level_only_matches_deep_enough_coverage_of_that_topic(self):
        # `exam-set` covers `self.topic` at only level 30 — asking for that specific topic at
        # depth >= 50 must exclude it, even though `exam-set` DOES have a level-95 row elsewhere
        # (on `other_topic`) that would satisfy the floor on its own.
        response = self.client.get(
            reverse('material-list'), {'topic_id': self.topic.pk, 'min_level': 50}
        )

        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'skrypt'})

    def test_min_level_alone_matches_any_topic_reaching_that_depth(self):
        response = self.client.get(reverse('material-list'), {'min_level': 90})

        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'skrypt', 'exam-set'})  # skrypt@90, exam-set@95 (other_topic)

    def test_sort_alphabetical(self):
        response = self.client.get(reverse('material-list'), {'sort': 'alphabetical'})

        titles = [row['title'] for row in response.data]
        self.assertEqual(titles, sorted(titles, key=str.casefold))

    def test_sort_level_orders_by_best_coverage_depth(self):
        response = self.client.get(reverse('material-list'), {'sort': 'level'})

        slugs = [row['slug'] for row in response.data]
        # exam-set's own best row is 95 (other_topic), skrypt's own best is 90 — exam-set first.
        self.assertEqual(slugs, ['exam-set', 'skrypt'])

    def test_sort_level_scoped_to_one_topic_ignores_coverage_of_other_topics(self):
        response = self.client.get(
            reverse('material-list'), {'sort': 'level', 'topic_id': self.topic.pk}
        )

        slugs = [row['slug'] for row in response.data]
        # Within `self.topic` alone: skrypt=90 beats exam-set=30 — the reverse of the unscoped order.
        self.assertEqual(slugs, ['skrypt', 'exam-set'])

    def test_sort_votes_orders_by_net_vote_weight(self):
        voter = make_user('sorter-voter')
        coverage = self.exam.coverage.get(topic=self.other_topic)
        MaterialCoverageVote.objects.create(coverage=coverage, voter=voter, value=1)

        response = self.client.get(reverse('material-list'), {'sort': 'votes'})

        slugs = [row['slug'] for row in response.data]
        self.assertEqual(slugs[0], 'exam-set')  # the only material with any net-positive vote weight

    def test_course_materials_action_honors_the_same_filters(self):
        response = self.client.get(
            reverse('branch-materials', kwargs={'slug': self.branch.slug}), {'type': 'script'}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'skrypt'})


class MaterialRecommendedTests(APITestCase):
    def test_anonymous_visitor_gets_the_honest_non_personalized_fallback(self):
        branch = make_course()
        make_material(branch, 'skrypt')

        response = self.client.get(reverse('material-recommended'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['personalized'])
        self.assertEqual(len(response.data['results']), 1)

    def test_featured_material_leads_the_non_personalized_fallback(self):
        branch = make_course()
        make_material(branch, 'plain')
        featured = make_material(branch, 'featured-one')
        featured.featured = True
        featured.save()

        response = self.client.get(reverse('material-recommended'))

        self.assertEqual(response.data['results'][0]['slug'], 'featured-one')

    def test_a_users_own_engagement_makes_the_response_personalized(self):
        from moderation.models import ContentView

        branch = make_course()
        make_material(branch, 'skrypt')
        exercise = make_exercise(branch, 1)
        user = make_user('engaged-reader')
        ContentView.objects.create(user=user, exercise=exercise)
        self.client.force_authenticate(user)

        response = self.client.get(reverse('material-recommended'))

        self.assertTrue(response.data['personalized'])

    def test_limit_param_is_honored_and_bounded(self):
        branch = make_course()
        for i in range(5):
            make_material(branch, f'mat-{i}')

        response = self.client.get(reverse('material-recommended'), {'limit': 2})

        self.assertEqual(len(response.data['results']), 2)


class MaterialPriceAndTimeSerializationTests(APITestCase):
    """Both fields are genuinely optional — a material that never sets either behaves exactly as
    before this feature existed (null on the wire, not a fabricated "Free"/"0 min" default)."""

    def test_unset_price_and_time_serialize_as_null(self):
        branch = make_course()
        material = make_material(branch, 'plain')

        response = self.client.get(reverse('material-detail', kwargs={'pk': material.pk}))

        self.assertIsNone(response.data['price_amount'])
        self.assertIsNone(response.data['estimated_minutes'])
        self.assertEqual(response.data['price_currency'], 'PLN')  # the model's own default

    def test_a_priced_material_with_a_time_estimate_serializes_both(self):
        branch = make_course()
        material = make_material(branch, 'priced')
        material.price_amount = '29.99'
        material.price_currency = 'EUR'
        material.estimated_minutes = 45
        material.save()

        response = self.client.get(reverse('material-detail', kwargs={'pk': material.pk}))

        self.assertEqual(response.data['price_amount'], '29.99')
        self.assertEqual(response.data['price_currency'], 'EUR')
        self.assertEqual(response.data['estimated_minutes'], 45)


class MaterialRequirementApiTests(APITestCase):
    """PUT /api/materials/{id}/requirements/ — the governor-facing (not "any authenticated user")
    bulk-replace endpoint. Gated by the exact same trust boundary moderation/services.py's
    `is_governor_of_course` already establishes for every other moderator-adjacent Material
    mutation — global staff, or a real governor of the material's own course."""

    def setUp(self):
        self.branch = make_course(slug='uw-requirement-branch')
        self.other_course = make_course(slug='uw-requirement-other-branch')
        self.material = make_material(self.branch, 'skrypt')

    def _put(self, labels):
        return self.client.put(
            reverse('material-requirements', kwargs={'pk': self.material.pk}),
            {'requirements': labels},
            format='json',
        )

    def test_anonymous_user_cannot_set_requirements(self):
        response = self._put(['English B2+'])
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_plain_authenticated_user_with_no_governor_grant_is_forbidden(self):
        self.client.force_authenticate(make_user('plain-student'))
        response = self._put(['English B2+'])
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.material.requirements.count(), 0)

    def test_global_staff_can_set_requirements(self):
        self.client.force_authenticate(make_user('staff-mod', is_staff=True))
        response = self._put(['English B2+', 'basic algebra'])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        labels = list(self.material.requirements.order_by('order').values_list('label', flat=True))
        self.assertEqual(labels, ['English B2+', 'basic algebra'])
        self.assertEqual([r['label'] for r in response.data['requirements']], labels)

    def test_a_governor_of_the_materials_own_course_can_set_requirements(self):
        governor = make_user('branch-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=self._course_content_type(),
            object_id=self.branch.pk,
        )
        self.client.force_authenticate(governor)

        response = self._put(['A graphing calculator'])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.material.requirements.count(), 1)

    def test_a_governor_of_a_different_course_is_forbidden(self):
        governor = make_user('other-branch-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=self._course_content_type(),
            object_id=self.other_course.pk,
        )
        self.client.force_authenticate(governor)

        response = self._put(['Should not apply'])

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.material.requirements.count(), 0)

    def test_setting_requirements_fully_replaces_the_previous_list_and_preserves_order(self):
        self.client.force_authenticate(make_user('replace-mod', is_staff=True))
        self._put(['first', 'second'])

        response = self._put(['only one now'])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.material.requirements.count(), 1)
        self.assertEqual(self.material.requirements.first().label, 'only one now')

    def test_blank_labels_are_dropped(self):
        self.client.force_authenticate(make_user('blank-mod', is_staff=True))
        response = self._put(['real one', '   ', ''])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        labels = list(self.material.requirements.values_list('label', flat=True))
        self.assertEqual(labels, ['real one'])

    def test_a_case_insensitive_duplicate_after_trimming_is_rejected_with_400(self):
        self.client.force_authenticate(make_user('dup-mod', is_staff=True))
        response = self._put(['English B2+', '  english b2+  '])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('requirements', response.data)
        # Rejected outright, not silently deduped — nothing should have been written.
        self.assertEqual(self.material.requirements.count(), 0)

    def test_an_exact_duplicate_is_also_rejected(self):
        self.client.force_authenticate(make_user('dup-mod-2', is_staff=True))
        response = self._put(['same', 'other', 'same'])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.material.requirements.count(), 0)

    @staticmethod
    def _course_content_type():
        from django.contrib.contenttypes.models import ContentType

        return ContentType.objects.get_for_model(Branch)


class MaterialRequirementProposalTests(APITestCase):
    """POST /api/materials/{id}/requirements/propose_requirement/ — open to any authenticated user,
    the requirement-side counterpart to MaterialCoverageProposalTests above (single-item propose,
    the community then votes — MaterialRequirementVoteTests already covers the voting half). Kept
    entirely separate from the governor-only bulk-replace PUT above, which is unaffected."""

    def setUp(self):
        self.branch = make_course(slug='uw-propose-requirement-branch')
        self.material = make_material(self.branch, 'skrypt-propose-req')
        self.user = make_user('requirement-proposer')
        self.client.force_authenticate(self.user)

    def _propose(self, label):
        return self.client.post(
            reverse('material-propose-requirement', kwargs={'pk': self.material.pk}),
            {'label': label},
            format='json',
        )

    def test_a_plain_authenticated_user_can_propose_a_new_requirement(self):
        response = self._propose('English B2+')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['label'], 'English B2+')
        self.assertEqual(self.material.requirements.count(), 1)

    def test_a_brand_new_proposal_starts_with_zero_votes(self):
        response = self._propose('basic algebra')

        self.assertEqual(response.data['vote_summary']['agree_count'], 0)
        self.assertEqual(response.data['vote_summary']['net_weight'], 0)

    def test_anonymous_user_cannot_propose_a_requirement(self):
        self.client.force_authenticate(None)
        response = self._propose('Should be rejected')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.material.requirements.count(), 0)

    def test_proposing_a_case_insensitive_duplicate_of_an_existing_requirement_is_rejected(self):
        MaterialRequirement.objects.create(material=self.material, label='English B2+')

        response = self._propose('  english b2+  ')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(self.material.requirements.count(), 1)

    def test_a_blank_label_is_rejected(self):
        response = self._propose('   ')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_two_different_users_can_each_propose_their_own_requirement(self):
        self._propose('English B2+')
        self.client.force_authenticate(make_user('second-proposer'))

        response = self._propose('basic algebra')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.material.requirements.count(), 2)

    def test_new_proposals_append_after_existing_requirements_order(self):
        MaterialRequirement.objects.create(material=self.material, label='first', order=0)
        MaterialRequirement.objects.create(material=self.material, label='second', order=1)

        response = self._propose('third')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['order'], 2)


class MaterialCoverageCommentThreadingTests(APITestCase):
    """Real, threaded discussion per MaterialCoverage claim — CLAUDE.md's own note: the model/API
    mostly already supported this (Comment.parent, CommentSerializer's own writable `parent` field),
    confirmed here rather than assumed, plus the one real gap closed alongside it: a submitted
    `parent` must actually belong to the SAME coverage's own comment set."""

    def setUp(self):
        self.branch = make_course()
        self.other_course = make_course(slug='uw-thread-other-branch')
        self.material = make_material(self.branch, 'skrypt')
        self.other_material = make_material(self.other_course, 'other-skrypt')
        self.topic = make_topic(self.branch)
        self.other_topic = make_topic(self.other_course, slug='other-thread-topic')
        self.coverage = MaterialCoverage.objects.create(
            material=self.material, topic=self.topic, level=70, proposed_by=make_user('thread-proposer')
        )
        self.other_coverage = MaterialCoverage.objects.create(
            material=self.other_material,
            topic=self.other_topic,
            level=40,
            proposed_by=make_user('other-thread-proposer'),
        )
        self.client.force_authenticate(make_user('thread-author'))

    def _post(self, coverage_pk, body, parent=None):
        payload = {'body': body}
        if parent is not None:
            payload['parent'] = parent
        return self.client.post(
            reverse('material-coverage-comments', kwargs={'pk': coverage_pk}), payload, format='json'
        )

    def test_a_reply_with_a_valid_parent_on_the_same_coverage_threads_correctly(self):
        root = self._post(self.coverage.pk, 'Is this level accurate?')
        self.assertEqual(root.status_code, status.HTTP_201_CREATED)
        root_id = root.data['id']

        reply = self._post(self.coverage.pk, 'I think so, yes.', parent=root_id)

        self.assertEqual(reply.status_code, status.HTTP_201_CREATED)
        self.assertEqual(reply.data['parent'], root_id)

        listing = self.client.get(reverse('material-coverage-comments', kwargs={'pk': self.coverage.pk}))
        ids_and_parents = {row['id']: row['parent'] for row in listing.data}
        self.assertEqual(ids_and_parents[reply.data['id']], root_id)

    def test_a_second_level_reply_also_threads_correctly(self):
        """Genuinely multi-level, not just one reply deep."""
        root = self._post(self.coverage.pk, 'Root comment')
        reply1 = self._post(self.coverage.pk, 'First reply', parent=root.data['id'])
        reply2 = self._post(self.coverage.pk, 'Reply to the reply', parent=reply1.data['id'])

        self.assertEqual(reply2.status_code, status.HTTP_201_CREATED)
        self.assertEqual(reply2.data['parent'], reply1.data['id'])

    def test_a_parent_from_an_unrelated_coverages_own_thread_is_rejected(self):
        """The real gap: a client could otherwise pass an arbitrary comment id belonging to a
        completely different MaterialCoverage's (or Exercise's) own discussion."""
        foreign_root = self._post(self.other_coverage.pk, 'A comment on a DIFFERENT coverage claim')
        self.assertEqual(foreign_root.status_code, status.HTTP_201_CREATED)

        response = self._post(self.coverage.pk, 'Trying to reply across coverage rows', parent=foreign_root.data['id'])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('parent', response.data)
        self.assertEqual(Comment.objects.filter(body='Trying to reply across coverage rows').count(), 0)

    def test_a_parent_from_an_exercise_comment_thread_is_also_rejected(self):
        """The same cross-target check catches a parent id that resolves to a real Comment, just one
        attached to an entirely different content type (an Exercise), not another MaterialCoverage."""
        exercise = make_exercise(self.branch, 1)
        exercise_comment_response = self.client.post(
            reverse('exercise-comments', kwargs={'pk': exercise.pk}), {'body': 'An exercise comment'}, format='json'
        )
        self.assertEqual(exercise_comment_response.status_code, status.HTTP_201_CREATED)

        response = self._post(
            self.coverage.pk, 'Trying to reply to an exercise comment', parent=exercise_comment_response.data['id']
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_nonexistent_parent_id_is_rejected_by_ordinary_field_validation(self):
        response = self._post(self.coverage.pk, 'A reply to nothing', parent=999999)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class MaterialRequirementVoteTests(APITestCase):
    """The new votable half of "split material tags into two groups (covers/requires), each
    votable, so users can sort by that" — mirrors MaterialCoverageVoteTests above exactly, just
    targeting a MaterialRequirement instead of a MaterialCoverage row."""

    def setUp(self):
        self.branch = make_course()
        self.material = make_material(self.branch, 'skrypt-req')
        self.requirement = MaterialRequirement.objects.create(material=self.material, label='English B2+')

    def _vote(self, user, value):
        self.client.force_authenticate(user)
        return self.client.post(
            reverse('material-requirement-vote', kwargs={'pk': self.requirement.pk}),
            {'value': value},
            format='json',
        )

    def test_agree_and_disagree_counts_are_computed_correctly(self):
        self._vote(make_user('req-voter1'), 1)
        self._vote(make_user('req-voter2'), 1)
        response = self._vote(make_user('req-voter3'), -1)

        summary = response.data['vote_summary']
        self.assertEqual(summary['agree_count'], 2)
        self.assertEqual(summary['disagree_count'], 1)
        self.assertEqual(summary['net_weight'], 1)

    def test_a_verified_contributors_vote_counts_double(self):
        contributor = make_user('req-vip', is_verified_contributor=True)
        response = self._vote(contributor, 1)

        summary = response.data['vote_summary']
        self.assertEqual(summary['agree_count'], 1)
        self.assertEqual(summary['agree_weight'], 2)

    def test_revoting_updates_the_existing_vote_rather_than_duplicating_it(self):
        voter = make_user('req-flip-flopper')
        self._vote(voter, 1)

        response = self._vote(voter, -1)

        self.assertEqual(
            MaterialRequirementVote.objects.filter(requirement=self.requirement, voter=voter).count(), 1
        )
        self.assertEqual(response.data['vote_summary']['agree_count'], 0)
        self.assertEqual(response.data['vote_summary']['disagree_count'], 1)

    def test_deleting_a_vote_removes_it(self):
        voter = make_user('req-remover')
        self._vote(voter, 1)

        response = self.client.delete(reverse('material-requirement-vote', kwargs={'pk': self.requirement.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(
            MaterialRequirementVote.objects.filter(requirement=self.requirement, voter=voter).exists()
        )

    def test_anonymous_vote_is_rejected(self):
        response = self.client.post(
            reverse('material-requirement-vote', kwargs={'pk': self.requirement.pk}), {'value': 1}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_an_invalid_value_is_rejected(self):
        self.client.force_authenticate(make_user('req-bad-voter'))
        response = self.client.post(
            reverse('material-requirement-vote', kwargs={'pk': self.requirement.pk}), {'value': 3}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sort_by_votes_ranks_a_material_with_more_net_requirement_votes_first(self):
        """The `?sort=votes` endpoint-level check — confirms requirement votes actually feed into
        the same ranking coverage votes already did, not just that the per-row vote_summary math
        works in isolation."""
        well_voted = make_material(self.branch, 'well-voted-reqs')
        well_voted_req = MaterialRequirement.objects.create(material=well_voted, label='Calculus I')
        for i in range(3):
            self._vote(make_user(f'sort-voter-{i}'), 1)  # votes on self.requirement (self.material)
        MaterialRequirementVote.objects.create(
            requirement=well_voted_req, voter=make_user('sort-voter-extra'), value=1
        )
        for i in range(5):
            MaterialRequirementVote.objects.create(
                requirement=well_voted_req, voter=make_user(f'sort-voter-more-{i}'), value=1
            )

        response = self.client.get(reverse('material-list'), {'sort': 'votes'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [row['id'] for row in response.data]
        self.assertEqual(ids[0], well_voted.pk)


class MaterialReviewsTests(APITestCase):
    """Star rating + optional written review on a Material — mirrors
    services/tests.py's own ServiceReviewsTests (the same upsert-on-resubmit shape, the same
    average_rating/review_count surfaced on the parent serializer)."""

    def setUp(self):
        self.branch = make_course()
        self.material = make_material(self.branch, 'reviewed-material')

    def test_creating_a_review_succeeds_and_is_listed(self):
        self.client.force_authenticate(make_user('mat-reviewer'))
        response = self.client.post(
            reverse('material-reviews', kwargs={'pk': self.material.pk}),
            {'rating': 5, 'body': 'Excellent script.'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        list_response = self.client.get(reverse('material-reviews', kwargs={'pk': self.material.pk}))
        self.assertEqual(len(list_response.data), 1)
        self.assertEqual(list_response.data[0]['rating'], 5)

    def test_resubmitting_updates_the_existing_review_rather_than_duplicating_it(self):
        reviewer = make_user('mat-resubmitter')
        self.client.force_authenticate(reviewer)
        self.client.post(
            reverse('material-reviews', kwargs={'pk': self.material.pk}), {'rating': 2, 'body': 'Meh.'}, format='json'
        )

        response = self.client.post(
            reverse('material-reviews', kwargs={'pk': self.material.pk}),
            {'rating': 5, 'body': 'Actually great on a second read.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)  # 200, not 201 — an update, not a create
        self.assertEqual(MaterialReview.objects.filter(material=self.material, author=reviewer).count(), 1)
        self.assertEqual(MaterialReview.objects.get(material=self.material, author=reviewer).rating, 5)

    def test_anonymous_review_is_rejected(self):
        response = self.client.post(
            reverse('material-reviews', kwargs={'pk': self.material.pk}), {'rating': 4}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_average_rating_and_review_count_reflect_real_reviews(self):
        self.client.force_authenticate(make_user('mat-reviewer-a'))
        self.client.post(
            reverse('material-reviews', kwargs={'pk': self.material.pk}), {'rating': 4}, format='json'
        )
        self.client.force_authenticate(make_user('mat-reviewer-b'))
        self.client.post(
            reverse('material-reviews', kwargs={'pk': self.material.pk}), {'rating': 2}, format='json'
        )

        response = self.client.get(reverse('material-detail', kwargs={'pk': self.material.pk}))

        self.assertEqual(response.data['average_rating'], 3.0)
        self.assertEqual(response.data['review_count'], 2)


class MaterialCommentsTests(APITestCase):
    """A whole-material discussion thread — "add discussions... to materials," distinct from the
    already-existing per-coverage-claim thread (MaterialCoverageCommentTests above)."""

    def setUp(self):
        self.branch = make_course()
        self.material = make_material(self.branch, 'discussed-material')

    def _post(self, body, parent=None):
        data = {'body': body}
        if parent is not None:
            data['parent'] = parent
        return self.client.post(reverse('material-comments', kwargs={'pk': self.material.pk}), data, format='json')

    def test_authenticated_user_can_post_a_root_comment(self):
        self.client.force_authenticate(make_user('mat-commenter'))
        response = self._post('Is this script up to date?')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_anonymous_comment_is_rejected(self):
        response = self._post('Trying to comment while logged out')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_reply_threads_correctly(self):
        self.client.force_authenticate(make_user('mat-root-author'))
        root = self._post('A root comment')

        self.client.force_authenticate(make_user('mat-reply-author'))
        reply = self._post('A reply', parent=root.data['id'])

        self.assertEqual(reply.status_code, status.HTTP_201_CREATED)
        self.assertEqual(reply.data['parent'], root.data['id'])

    def test_a_parent_from_a_different_materials_own_thread_is_rejected(self):
        other_material = make_material(self.branch, 'a-different-material')
        self.client.force_authenticate(make_user('mat-cross-target-author'))
        other_root = self.client.post(
            reverse('material-comments', kwargs={'pk': other_material.pk}), {'body': 'On a different material'}, format='json'
        )

        response = self._post('Trying to reply across materials', parent=other_root.data['id'])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_get_lists_comments_publicly_with_no_auth_required(self):
        self.client.force_authenticate(make_user('mat-public-commenter'))
        self._post('A publicly-readable comment')
        self.client.force_authenticate(None)

        response = self.client.get(reverse('material-comments', kwargs={'pk': self.material.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)

