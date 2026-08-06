from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from testing.factories import make_branch, make_topic

from taxonomy.models import Branch, BranchTranslation, Discipline, DisciplineTranslation


class DisciplineListTests(APITestCase):
    def test_only_published_disciplines_are_listed(self):
        published = Discipline.objects.create(slug='matematyka', published=True)
        DisciplineTranslation.objects.create(
            discipline=published, locale='pl', name='Matematyka'
        )
        Discipline.objects.create(slug='chemia', published=False)

        response = self.client.get(reverse('discipline-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'matematyka'})

    def test_discipline_branches_lists_only_published_branches_in_that_discipline(self):
        discipline = Discipline.objects.create(slug='matematyka', published=True)
        DisciplineTranslation.objects.create(
            discipline=discipline, locale='pl', name='Matematyka'
        )
        published = Branch.objects.create(
            slug='published-branch', discipline=discipline, published=True
        )
        BranchTranslation.objects.create(branch=published, locale='pl', name='Published')
        Branch.objects.create(slug='unpublished-branch', discipline=discipline, published=False)

        response = self.client.get(
            reverse('discipline-branches', kwargs={'slug': discipline.slug})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'published-branch'})


class BranchDetailTests(APITestCase):
    def test_branch_detail_includes_its_own_topics(self):
        branch = make_branch()
        make_topic(branch, slug='topic-a')
        make_topic(branch, slug='topic-b')

        response = self.client.get(reverse('branch-detail', kwargs={'slug': branch.slug}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        topic_slugs = {t['slug'] for t in response.data['topics']}
        self.assertEqual(topic_slugs, {'topic-a', 'topic-b'})

    def test_an_unpublished_branch_404s(self):
        discipline = Discipline.objects.create(slug='matematyka', published=True)
        Branch.objects.create(slug='draft-branch', discipline=discipline, published=False)

        response = self.client.get(reverse('branch-detail', kwargs={'slug': 'draft-branch'}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class BranchLocaleTests(APITestCase):
    """The reason `?lang=` exists at all: a branch's name must follow the reader's language, and a
    missing translation must fall back to the original rather than to whatever locale happens to
    sort first. Before the taxonomy service started sending `lang`, the backend defaulted to 'en'
    and a single English row made every reader see English."""

    def setUp(self):
        self.discipline = Discipline.objects.create(slug='matematyka', published=True)
        DisciplineTranslation.objects.create(
            discipline=self.discipline, locale='pl', name='Matematyka'
        )
        DisciplineTranslation.objects.create(
            discipline=self.discipline, locale='en', name='Mathematics'
        )

    def test_the_requested_locale_wins(self):
        response = self.client.get(reverse('discipline-list'), {'lang': 'en'})
        self.assertEqual(response.data[0]['name'], 'Mathematics')

        response = self.client.get(reverse('discipline-list'), {'lang': 'pl'})
        self.assertEqual(response.data[0]['name'], 'Matematyka')

    def test_an_unknown_locale_falls_back_to_the_original_not_to_english(self):
        response = self.client.get(reverse('discipline-list'), {'lang': 'de'})
        self.assertEqual(response.data[0]['name'], 'Matematyka')

    def test_no_lang_at_all_falls_back_to_the_original_not_to_english(self):
        response = self.client.get(reverse('discipline-list'))
        self.assertEqual(response.data[0]['name'], 'Matematyka')
