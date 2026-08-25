"""Covers/requires claims on a user-run course — the same claims a material carries, pinned at the
boundaries that fail silently: the topic must come from one of the course's subjects, a claim on a
course you cannot see is a 404, both votes tally separately, and the thread is the claim's own."""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment
from testing.factories import make_course as make_branch, make_topic, make_user

from .models import Course, CourseClaim


class CourseClaimTests(APITestCase):
    def setUp(self):
        self.branch = make_branch()
        self.other_branch = make_branch(slug='uw-other-branch')
        self.topic = make_topic(self.branch)
        self.foreign_topic = make_topic(self.other_branch, slug='foreign')
        self.instructor = make_user('claim-instructor')
        self.course = Course.objects.create(
            instructor=self.instructor, title='Analiza od zera', visibility='public', status='open'
        )
        self.course.subjects.add(self.branch)
        self.user = make_user('claim-user')
        self.client.force_authenticate(self.user)

    def _propose(self, **body):
        return self.client.post(
            reverse('course-claims', kwargs={'pk': self.course.pk}),
            {'topic': self.topic.pk, 'level': 60, **body},
            format='json',
        )

    def test_proposing_a_covers_and_a_requires_claim_on_the_same_topic(self):
        self.assertEqual(self._propose().status_code, status.HTTP_201_CREATED)
        response = self._propose(kind='requires', level=25)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['kind'], 'requires')
        self.assertEqual(response.data['course'], self.course.pk)
        self.assertEqual(CourseClaim.objects.filter(course=self.course).count(), 2)

    def test_a_duplicate_of_the_same_kind_is_refused(self):
        self._propose()
        self.assertEqual(self._propose().status_code, status.HTTP_409_CONFLICT)

    def test_a_topic_outside_the_courses_subjects_is_refused(self):
        response = self._propose(topic=self.foreign_topic.pk)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_subtopic_can_be_created_on_the_fly(self):
        response = self._propose(subtopic_slug='granice', subtopic_name='Granice')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['subtopic']['slug'], 'granice')

    def test_anonymous_can_read_but_not_propose(self):
        self._propose()
        self.client.force_authenticate(None)
        listing = self.client.get(reverse('course-claims', kwargs={'pk': self.course.pk}))
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertEqual(len(listing.data), 1)
        self.assertEqual(self._propose(level=10).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_claim_on_a_course_you_cannot_see_is_a_404(self):
        hidden = Course.objects.create(
            instructor=self.instructor, title='Private', visibility='only_you', status='open'
        )
        hidden.subjects.add(self.branch)
        claim = CourseClaim.objects.create(course=hidden, topic=self.topic, level=50)
        response = self.client.post(
            reverse('course-claim-vote', kwargs={'pk': claim.pk}), {'value': 1}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_accuracy_and_importance_votes_are_separate(self):
        claim = CourseClaim.objects.create(course=self.course, topic=self.topic, level=50)
        vip = make_user('claim-vip', is_verified_contributor=True)
        self.client.force_authenticate(vip)
        accuracy = self.client.post(
            reverse('course-claim-vote', kwargs={'pk': claim.pk}), {'value': 1}, format='json'
        )
        self.assertEqual(accuracy.data['vote_summary']['agree_weight'], 2)
        self.assertEqual(accuracy.data['importance_summary']['net_weight'], 0)
        importance = self.client.post(
            reverse('course-claim-importance', kwargs={'pk': claim.pk}), {'value': -1}, format='json'
        )
        self.assertEqual(importance.data['importance_summary']['net_weight'], -2)
        self.assertEqual(importance.data['vote_summary']['agree_weight'], 2)
        retracted = self.client.delete(reverse('course-claim-importance', kwargs={'pk': claim.pk}))
        self.assertEqual(retracted.data['importance_summary']['net_weight'], 0)

    def test_the_thread_belongs_to_the_claim(self):
        claim = CourseClaim.objects.create(course=self.course, topic=self.topic, level=50)
        other = CourseClaim.objects.create(course=self.course, topic=self.topic, level=50, kind='requires')
        url = reverse('course-claim-comments', kwargs={'pk': claim.pk})
        root = self.client.post(url, {'body': 'Is 60 right?'}, format='json')
        self.assertEqual(root.status_code, status.HTTP_201_CREATED)
        stray = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(CourseClaim),
            object_id=other.pk,
            author=self.user,
            body='elsewhere',
        )
        wrong = self.client.post(url, {'body': 'reply', 'parent': stray.pk}, format='json')
        self.assertEqual(wrong.status_code, status.HTTP_400_BAD_REQUEST)
        listing = self.client.get(url)
        self.assertEqual([c['body'] for c in listing.data], ['Is 60 right?'])
        detail = self.client.get(reverse('course-claims', kwargs={'pk': self.course.pk}))
        self.assertEqual(detail.data[0]['comment_count'], 1)
