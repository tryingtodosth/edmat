"""Part of this project's automated test suite (CLAUDE.md Section 17L)."""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from materials.models import MaterialCoverage, MaterialCoverageVote
from testing.factories import make_course, make_material, make_topic, make_user


class MaterialListingTests(APITestCase):
    def setUp(self):
        self.course = make_course()
        self.material = make_material(
            self.course, 'skrypt', title='Course script', description='The full lecture script.'
        )

    def test_course_materials_lists_published_materials(self):
        response = self.client.get(reverse('course-materials', kwargs={'slug': self.course.slug}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['slug'], 'skrypt')

    def test_search_matches_on_title(self):
        make_material(self.course, 'exam-collection', title='Exam collection', description='Past exams.')

        response = self.client.get(reverse('material-list'), {'q': 'exam'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'exam-collection'})

    def test_search_matches_on_description_too(self):
        response = self.client.get(reverse('material-list'), {'q': 'lecture script'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'skrypt'})


class MaterialCoverageProposalTests(APITestCase):
    def setUp(self):
        self.course = make_course()
        self.other_course = make_course(slug='uw-other-course')
        self.material = make_material(self.course, 'skrypt')
        self.topic = make_topic(self.course)
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
        self.course = make_course()
        self.material = make_material(self.course, 'skrypt')
        self.topic = make_topic(self.course)
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
        course = make_course()
        material = make_material(course, 'skrypt')
        topic = make_topic(course)
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
