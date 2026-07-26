"""Part of this project's automated test suite (CLAUDE.md Section 17L)."""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from taxonomy.models import Course, CourseTranslation, Field, FieldTranslation
from testing.factories import make_course, make_topic


class FieldListingTests(APITestCase):
    def test_only_published_fields_are_listed(self):
        Field.objects.create(slug='matematyka', published=True)
        Field.objects.create(slug='hidden-field', published=False)

        response = self.client.get(reverse('field-list'))

        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'matematyka'})

    def test_field_courses_lists_only_published_courses_in_that_field(self):
        field = Field.objects.create(slug='matematyka', published=True)
        FieldTranslation.objects.create(field=field, locale='pl', name='Matematyka')
        published_course = Course.objects.create(
            slug='published-course', field=field, university='UW', published=True
        )
        CourseTranslation.objects.create(course=published_course, locale='pl', name='Published')
        Course.objects.create(slug='unpublished-course', field=field, university='UW', published=False)

        response = self.client.get(reverse('field-courses', kwargs={'slug': field.slug}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'published-course'})


class CourseDetailTests(APITestCase):
    def test_course_detail_includes_its_own_topics(self):
        course = make_course()
        make_topic(course, slug='topic-a')
        make_topic(course, slug='topic-b')

        response = self.client.get(reverse('course-detail', kwargs={'slug': course.slug}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        topic_slugs = {t['slug'] for t in response.data['topics']}
        self.assertEqual(topic_slugs, {'topic-a', 'topic-b'})

    def test_an_unpublished_course_404s(self):
        field = Field.objects.create(slug='matematyka', published=True)
        Course.objects.create(slug='draft-course', field=field, university='UW', published=False)

        response = self.client.get(reverse('course-detail', kwargs={'slug': 'draft-course'}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
