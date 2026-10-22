"""`/api/licences/mine/` and `/api/licences/bulk/` (`licensing/bulk.py`, 2026-10-22).

What this pins down: the list is the caller's own POSTED items only, each with what the rules allow
and why when nothing; the bulk move goes through `rules.change_licence` item by item (narrowing and
a co-author's work refused with their reason, the rest moved, a `LicenceChange` row each); a
stranger's id, an unpublished item and a missing one come back with the same `licence_not_found`;
anonymous is 401; a malformed or oversized request is 400 and changes nothing; the POST throttle
has its own scope.
"""

from __future__ import annotations

from django.core.cache import cache
from rest_framework.test import APITestCase

from coauthoring.models import MaterialProject, MaterialVersion, ProjectMember
from concepts.models import Concept, ConceptArticle, ConceptRevision
from exercises.models import Exercise, ExerciseTranslation, SolutionEntry
from licensing import bulk
from licensing.models import LicenceChange
from materials.models import Material
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_material, make_user, make_viewer


class BulkBase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        cache.clear()
        self.branch = make_branch('bulk-branch')
        self.me = make_user('bulk-me')
        self.other = make_user('bulk-other')
        # mine, edmat-only
        self.ex1 = make_exercise(self.branch, 1, title='Pierwsze')
        self.ex2 = make_exercise(self.branch, 2, title='Drugie')
        # mine, already BY-NC: BY-SA is incomparable (a narrowing to the rules)
        self.ex_nc = make_exercise(self.branch, 3, title='Niekomercyjne')
        # mine but unpublished: not posted, not listed, not movable here
        self.ex_draft = make_exercise(self.branch, 4, title='Szkic')
        # somebody else's
        self.ex_theirs = make_exercise(self.branch, 5, title='Cudze')
        Exercise.objects.filter(pk__in=[self.ex1.pk, self.ex2.pk, self.ex_nc.pk, self.ex_draft.pk]).update(
            submitted_by=self.me, licence='edmat-only'
        )
        Exercise.objects.filter(pk=self.ex_nc.pk).update(licence='cc-by-nc-4.0')
        Exercise.objects.filter(pk=self.ex_draft.pk).update(published=False)
        Exercise.objects.filter(pk=self.ex_theirs.pk).update(submitted_by=self.other, licence='edmat-only')
        for ex in (self.ex1, self.ex2, self.ex_nc, self.ex_draft, self.ex_theirs):
            ex.refresh_from_db()
        ExerciseTranslation.objects.filter(exercise=self.ex_nc).update(licence='cc-by-nc-4.0')

        self.entry = SolutionEntry.objects.create(
            exercise=self.ex_theirs, kind='solution', body='x', status='published', author=self.me, licence='edmat-only'
        )
        # a material with a co-author's published version in it: nothing to offer, and why
        self.material = make_material(self.branch, 'bulk-material', title='Skrypt')
        Material.objects.filter(pk=self.material.pk).update(submitted_by=self.me, licence='edmat-only')
        self.material.refresh_from_db()
        project = MaterialProject.objects.create(material=self.material, branch=self.branch, created_by=self.me)
        coauthor = make_viewer('bulk-coauthor')
        ProjectMember.objects.create(project=project, user=coauthor, role='coauthor')
        MaterialVersion.objects.create(project=project, number=1, status='published', title='v1', created_by=coauthor)

        concept = Concept.objects.create(slug='bulk-pojecie', created_by=self.me)
        self.article = ConceptArticle.objects.create(
            concept=concept, locale='pl', created_by=self.me, licence='edmat-only'
        )
        ConceptRevision.objects.create(
            article=self.article, number=1, status='published', title='Pojęcie', created_by=self.me
        )

    def mine(self):
        return self.client.get('/api/licences/mine/').data['kinds']

    def bulk(self, to, items):
        return self.client.post('/api/licences/bulk/', {'to': to, 'items': items}, format='json')


class MyLicencesTests(BulkBase):
    def test_anonymous_is_401(self):
        self.assertEqual(self.client.get('/api/licences/mine/').status_code, 401)
        self.assertEqual(self.bulk('cc-by-4.0', [{'kind': 'exercise', 'id': self.ex1.pk}]).status_code, 401)

    def test_lists_only_my_posted_items_with_what_each_may_become(self):
        self.client.force_authenticate(self.me)
        kinds = self.mine()
        ex = {row['id']: row for row in kinds['exercise']['items']}
        self.assertEqual(set(ex), {str(self.ex1.pk), str(self.ex2.pk), str(self.ex_nc.pk)})
        self.assertEqual(ex[str(self.ex1.pk)]['title'], 'Pierwsze')
        self.assertEqual(ex[str(self.ex1.pk)]['licence'], 'edmat-only')
        self.assertIn('cc-by-sa-4.0', ex[str(self.ex1.pk)]['allowed'])
        self.assertNotIn('unknown', ex[str(self.ex1.pk)]['allowed'])
        # BY-NC can widen to BY or CC0, never to BY-SA
        self.assertEqual(set(ex[str(self.ex_nc.pk)]['allowed']), {'cc0-1.0', 'cc-by-4.0'})
        # my solution on somebody else's exercise is mine to relicense
        entry = kinds['solution_entry']['items']
        self.assertEqual([r['id'] for r in entry], [str(self.entry.pk)])
        self.assertEqual(entry[0]['exercise_id'], str(self.ex_theirs.pk))
        self.assertEqual(entry[0]['entry_kind'], 'solution')
        material = kinds['material']['items'][0]
        self.assertEqual(material['allowed'], [])
        self.assertEqual(material['blocked_reason'], 'licence_other_contributors')
        article = kinds['concept_article']['items'][0]
        self.assertEqual((article['title'], article['concept_slug']), ('Pojęcie', 'bulk-pojecie'))
        self.assertFalse(kinds['exercise']['truncated'])

    def test_somebody_elses_list_holds_none_of_mine(self):
        self.client.force_authenticate(self.other)
        ex = self.mine()['exercise']['items']
        self.assertEqual([r['id'] for r in ex], [str(self.ex_theirs.pk)])
        self.assertEqual(self.mine()['solution_entry']['items'], [])

    def test_the_list_is_bounded_and_says_so(self):
        self.client.force_authenticate(self.me)
        original = bulk.MINE_LIMIT_PER_KIND
        bulk.MINE_LIMIT_PER_KIND = 2
        try:
            ex = self.mine()['exercise']
        finally:
            bulk.MINE_LIMIT_PER_KIND = original
        self.assertEqual(len(ex['items']), 2)
        self.assertTrue(ex['truncated'])


class BulkChangeTests(BulkBase):
    def test_moves_what_the_rules_allow_and_refuses_the_rest_with_reasons(self):
        self.client.force_authenticate(self.me)
        response = self.bulk(
            'cc-by-sa-4.0',
            [
                {'kind': 'exercise', 'id': self.ex1.pk},
                {'kind': 'exercise', 'id': str(self.ex2.pk)},
                {'kind': 'exercise', 'id': self.ex_nc.pk},
                {'kind': 'solution_entry', 'id': self.entry.pk},
                {'kind': 'material', 'id': self.material.pk},
                {'kind': 'concept_article', 'id': self.article.pk},
                {'kind': 'exercise', 'id': self.ex1.pk},  # a duplicate counts once
            ],
        )
        self.assertEqual(response.status_code, 200)
        by = {(r['kind'], r['id']): r for r in response.data['results']}
        self.assertEqual(len(by), 6)
        self.assertEqual(response.data['changed'], 4)
        self.assertEqual(response.data['refused'], 2)
        self.assertEqual(by[('exercise', str(self.ex_nc.pk))]['reason'], 'licence_narrowing')
        self.assertEqual(by[('material', str(self.material.pk))]['reason'], 'licence_other_contributors')
        self.assertTrue(by[('exercise', str(self.ex1.pk))]['ok'])
        self.assertEqual(by[('exercise', str(self.ex1.pk))]['from'], 'edmat-only')
        self.ex1.refresh_from_db()
        self.ex_nc.refresh_from_db()
        self.entry.refresh_from_db()
        self.article.refresh_from_db()
        self.assertEqual(self.ex1.licence, 'cc-by-sa-4.0')
        self.assertEqual(self.ex_nc.licence, 'cc-by-nc-4.0')
        self.assertEqual(self.entry.licence, 'cc-by-sa-4.0')
        self.assertEqual(self.article.licence, 'cc-by-sa-4.0')
        # the exercise's own-language text moved with it (rules._carry_to_own_text)
        self.assertEqual(ExerciseTranslation.objects.get(exercise=self.ex1).licence, 'cc-by-sa-4.0')
        rows = LicenceChange.objects.all()
        self.assertEqual(rows.count(), 4)
        self.assertTrue(all(r.changed_by == self.me and not r.as_staff for r in rows))

    def test_a_second_run_changes_nothing_and_says_unchanged(self):
        self.client.force_authenticate(self.me)
        self.bulk('cc-by-4.0', [{'kind': 'exercise', 'id': self.ex1.pk}])
        again = self.bulk('cc-by-4.0', [{'kind': 'exercise', 'id': self.ex1.pk}])
        self.assertEqual(again.data['results'][0]['reason'], 'licence_unchanged')
        self.assertEqual(LicenceChange.objects.count(), 1)

    def test_a_strangers_id_a_draft_and_a_missing_one_read_the_same(self):
        self.client.force_authenticate(self.me)
        response = self.bulk(
            'cc-by-4.0',
            [
                {'kind': 'exercise', 'id': self.ex_theirs.pk},
                {'kind': 'exercise', 'id': self.ex_draft.pk},
                {'kind': 'exercise', 'id': 987654},
            ],
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual({r['reason'] for r in response.data['results']}, {'licence_not_found'})
        # nothing about the stranger's item rides back — not even its licence
        self.assertTrue(all('licence' not in r for r in response.data['results']))
        self.ex_theirs.refresh_from_db()
        self.ex_draft.refresh_from_db()
        self.assertEqual((self.ex_theirs.licence, self.ex_draft.licence), ('edmat-only', 'edmat-only'))
        self.assertEqual(LicenceChange.objects.count(), 0)

    def test_staff_get_no_extra_reach_here(self):
        staff = make_user('bulk-staff', is_staff=True)
        self.client.force_authenticate(staff)
        response = self.bulk('cc-by-4.0', [{'kind': 'exercise', 'id': self.ex1.pk}])
        self.assertEqual(response.data['results'][0]['reason'], 'licence_not_found')

    def test_unknown_and_edmat_only_are_refused_as_targets(self):
        self.client.force_authenticate(self.me)
        response = self.bulk('unknown', [{'kind': 'exercise', 'id': self.ex1.pk}])
        self.assertEqual(response.data['results'][0]['reason'], 'licence_not_selectable')
        response = self.bulk('cc-by-4.0', [{'kind': 'exercise', 'id': self.ex1.pk}])
        self.assertTrue(response.data['results'][0]['ok'])
        response = self.bulk('edmat-only', [{'kind': 'exercise', 'id': self.ex1.pk}])
        self.assertEqual(response.data['results'][0]['reason'], 'licence_narrowing')

    def test_malformed_requests_are_400_and_change_nothing(self):
        self.client.force_authenticate(self.me)
        cases = [
            ({'to': 'cc-by-4.0'}, 'licence_bulk_items_required'),
            ({'to': 'cc-by-4.0', 'items': []}, 'licence_bulk_items_required'),
            ({'to': 'cc-by-4.0', 'items': [{'kind': 'comment', 'id': 1}]}, 'licence_bulk_item_invalid'),
            ({'to': 'cc-by-4.0', 'items': [{'kind': 'exercise', 'id': 'x'}]}, 'licence_bulk_item_invalid'),
            ({'to': 'cc-by-4.0', 'items': ['exercise']}, 'licence_bulk_item_invalid'),
            ({'to': 'mit', 'items': [{'kind': 'exercise', 'id': self.ex1.pk}]}, 'licence_unknown_key'),
            ({'items': [{'kind': 'exercise', 'id': self.ex1.pk}]}, 'licence_unknown_key'),
        ]
        for payload, word in cases:
            response = self.client.post('/api/licences/bulk/', payload, format='json')
            self.assertEqual((response.status_code, response.data['detail']), (400, word), payload)
        self.assertEqual(LicenceChange.objects.count(), 0)

    def test_more_than_the_cap_is_refused_whole(self):
        self.client.force_authenticate(self.me)
        items = [{'kind': 'exercise', 'id': self.ex1.pk}] + [
            {'kind': 'exercise', 'id': 100000 + i} for i in range(bulk.BULK_MAX_ITEMS)
        ]
        response = self.bulk('cc-by-4.0', items)
        self.assertEqual((response.status_code, response.data['detail']), (400, 'licence_bulk_too_many'))
        self.ex1.refresh_from_db()
        self.assertEqual(self.ex1.licence, 'edmat-only')

    def test_the_post_has_its_own_throttle_and_reading_does_not_spend_it(self):
        from rest_framework.settings import api_settings

        limit = int(api_settings.DEFAULT_THROTTLE_RATES['licence_bulk'].split('/')[0])
        self.client.force_authenticate(self.me)
        for _ in range(3):
            self.assertEqual(self.client.get('/api/licences/mine/').status_code, 200)
        item = [{'kind': 'exercise', 'id': self.ex2.pk}]
        for _ in range(limit):
            self.assertEqual(self.bulk('cc-by-4.0', item).status_code, 200)
        self.assertEqual(self.bulk('cc-by-4.0', item).status_code, 429)
