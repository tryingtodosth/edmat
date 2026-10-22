"""The per-item content licence (licensing/, 2026-10-14).

What each class pins down:

- `RegistryTests` — the registry's own algebra: which way a change may go, the derivative rule,
  what a person may pick.
- `ClassificationMigrationTests` — the data migrations' honest split: corpus → `unknown`, content a
  person submitted through the site → `edmat-only`.
- `SubmissionLicenceTests` — `/submit`'s payload: a licence is carried onto the exercise and its
  founding hint/solution; `unknown` and stray keys are refused; absent is `edmat-only`.
- `TranslationDerivativeTests` — a translation carries its parent's licence at the moment it is
  written, and keeps it when the parent widens later.
- `LicenceChangeEndpointTests` — `/api/licences/<kind>/<id>/`: only widening, only the author or
  staff, the history and "since", staff's `unknown` marker, co-authors, 404 for a hidden item.
- `ImporterLicenceTests` — `import_exercises`: the `licence:` key, its default, its refusal, and a
  re-run that only widens.
- `CreationPathTests` — the other three create paths (a solution, a material project, a concept
  article) accept a choice and refuse `unknown`, and the list filter narrows.
"""

from __future__ import annotations

import importlib
import shutil
import tempfile
from io import StringIO
from pathlib import Path
from textwrap import dedent

from django.apps import apps as django_apps
from django.core.cache import cache
from django.core.management import CommandError, call_command
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import Exercise, ExerciseTranslation, SolutionEntry
from licensing.licences import (
    DEFAULT_LICENCE,
    LICENCES,
    SELECTABLE_LICENCES,
    UNKNOWN,
    at_least_as_open,
    derivative_licence,
    licence_validation_error,
    parse_licence_param,
)
from licensing.models import LicenceChange
from licensing.rules import licence_since
from materials.models import Material
from moderation.models import ExerciseSubmission
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_material, make_user, make_viewer


class RegistryTests(TestCase):
    def test_unknown_is_never_selectable_and_everything_else_is(self):
        self.assertNotIn(UNKNOWN, SELECTABLE_LICENCES)
        self.assertEqual(set(SELECTABLE_LICENCES), set(LICENCES) - {UNKNOWN})
        self.assertEqual(licence_validation_error(UNKNOWN), 'licence_not_selectable')
        self.assertEqual(licence_validation_error('gpl-3.0'), 'licence_unknown_key')
        self.assertIsNone(licence_validation_error('cc-by-4.0'))

    def test_the_default_opens_nothing(self):
        self.assertEqual(DEFAULT_LICENCE, 'edmat-only')
        self.assertFalse(LICENCES[DEFAULT_LICENCE].public_reuse)

    def test_no_licence_offered_forbids_derivatives(self):
        """A translation is a derivative; an ND licence would forbid the site's own translations."""
        for key, lic in LICENCES.items():
            if lic.public_reuse:
                self.assertTrue(lic.derivatives, key)

    def test_widening_is_allowed_and_narrowing_is_not(self):
        self.assertTrue(at_least_as_open('cc-by-sa-4.0', 'edmat-only'))
        self.assertTrue(at_least_as_open('cc-by-nc-4.0', 'unknown'))
        self.assertTrue(at_least_as_open('cc-by-4.0', 'cc-by-sa-4.0'))
        self.assertTrue(at_least_as_open('cc0-1.0', 'cc-by-4.0'))
        self.assertTrue(at_least_as_open('cc-by-sa-4.0', 'cc-by-nc-sa-4.0'))
        self.assertTrue(at_least_as_open('cc-by-nc-4.0', 'cc-by-nc-sa-4.0'))
        self.assertFalse(at_least_as_open('edmat-only', 'cc-by-4.0'))
        self.assertFalse(at_least_as_open('cc-by-sa-4.0', 'cc-by-4.0'))
        self.assertFalse(at_least_as_open('cc-by-4.0', 'cc0-1.0'))
        self.assertFalse(at_least_as_open('cc-by-nc-4.0', 'cc-by-4.0'))

    def test_nc_and_sa_are_incomparable(self):
        """Each forbids something the other allows, so neither may become the other."""
        self.assertFalse(at_least_as_open('cc-by-nc-4.0', 'cc-by-sa-4.0'))
        self.assertFalse(at_least_as_open('cc-by-sa-4.0', 'cc-by-nc-4.0'))

    def test_a_derivative_keeps_its_parents_licence(self):
        for key in LICENCES:
            self.assertEqual(derivative_licence(key), key)
        self.assertEqual(derivative_licence('nonsense'), UNKNOWN)

    def test_the_list_filter_parses_known_keys_only(self):
        self.assertEqual(parse_licence_param('cc-by-4.0,bogus,cc0-1.0'), ['cc-by-4.0', 'cc0-1.0'])
        self.assertIsNone(parse_licence_param('bogus'))
        self.assertIsNone(parse_licence_param(''))


class ClassificationMigrationTests(TestCase):
    """Runs the migrations' own classify functions against rows made the way each kind of row was
    really made, with the live app registry standing in for the historical one (the same API)."""

    def test_exercises_only_a_real_submission_is_edmat_only(self):
        """`submitted_by` is NOT the test: `seed_demo_content` attributes corpus rows to demo
        accounts. A kept `ExerciseSubmission` is the evidence that a person submitted it here."""
        branch = make_branch('cls-branch')
        submitter = make_viewer('cls-submitter')
        corpus = make_exercise(branch, 1)
        seeded = make_exercise(branch, 3)
        Exercise.objects.filter(pk=seeded.pk).update(submitted_by=submitter)
        mine = make_exercise(branch, 2)
        Exercise.objects.filter(pk=mine.pk).update(submitted_by=submitter)
        ExerciseSubmission.objects.create(
            branch=branch, submitted_by=submitter, payload={}, status='approved', resulting_exercise=mine
        )
        corpus_original = SolutionEntry.objects.create(
            exercise=corpus, kind='solution', locale='pl', body='x', status='published', pinned=True, author=submitter
        )
        user_entry_on_corpus = SolutionEntry.objects.create(
            exercise=corpus, kind='hint', locale='pl', body='y', status='published', author=submitter
        )
        orphan_entry_on_mine = SolutionEntry.objects.create(exercise=mine, kind='hint', locale='pl', body='z', status='published')
        Exercise.objects.update(licence='edmat-only')
        ExerciseTranslation.objects.update(licence='')

        importlib.import_module('exercises.migrations.0015_licence').classify(django_apps, None)

        self.assertEqual(Exercise.objects.get(pk=corpus.pk).licence, 'unknown')
        self.assertEqual(Exercise.objects.get(pk=seeded.pk).licence, 'unknown')
        self.assertEqual(Exercise.objects.get(pk=mine.pk).licence, 'edmat-only')
        self.assertEqual(ExerciseTranslation.objects.get(exercise=corpus).licence, 'unknown')
        self.assertEqual(ExerciseTranslation.objects.get(exercise=mine).licence, 'edmat-only')
        self.assertEqual(SolutionEntry.objects.get(pk=corpus_original.pk).licence, 'unknown')
        self.assertEqual(SolutionEntry.objects.get(pk=user_entry_on_corpus.pk).licence, 'edmat-only')
        self.assertEqual(SolutionEntry.objects.get(pk=orphan_entry_on_mine.pk).licence, 'edmat-only')

    def test_materials_imported_files_are_unknown_even_when_somebody_was_credited(self):
        branch = make_branch('cls-mat-branch')
        owner = make_viewer('cls-mat-owner')
        corpus = make_material(branch, 'corpus-pdf')  # file under materials/ — the importer's path
        credited_corpus = make_material(branch, 'credited-corpus-pdf')
        Material.objects.filter(pk=credited_corpus.pk).update(submitted_by=owner)
        uploaded = make_material(branch, 'uploaded')
        Material.objects.filter(pk=uploaded.pk).update(
            submitted_by=owner, file='material_versions/abc.pdf'
        )

        importlib.import_module('materials.migrations.0019_licence').classify(django_apps, None)

        self.assertEqual(Material.objects.get(pk=corpus.pk).licence, 'unknown')
        self.assertEqual(Material.objects.get(pk=credited_corpus.pk).licence, 'unknown')
        self.assertEqual(Material.objects.get(pk=uploaded.pk).licence, 'edmat-only')


class SubmissionLicenceTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        cache.clear()
        self.branch = make_branch('sub-licence-branch')
        self.student = make_user('sub-licence-student')
        self.moderator = make_user('sub-licence-mod', is_staff=True)

    def _post(self, **extras):
        self.client.force_authenticate(self.student)
        return self.client.post(
            reverse('exercise-submission-list'),
            {
                'branch': self.branch.slug,
                'payload': {
                    'difficulty': 'easy',
                    'locale': 'pl',
                    'title': 'Licensed',
                    'statement': 'Prove it.',
                    'solution': 'Because.',
                    **extras,
                },
            },
            format='json',
        )

    def _approve(self, submission_id):
        self.client.force_authenticate(self.moderator)
        return self.client.post(
            reverse('moderation-action', kwargs={'kind': 'submission', 'pk': submission_id, 'decision': 'approve'}),
            {},
            format='json',
        )

    def test_the_chosen_licence_reaches_the_exercise_and_its_founding_solution(self):
        response = self._post(licence='cc-by-sa-4.0')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(self._approve(response.data['id']).status_code, status.HTTP_200_OK)
        exercise = ExerciseSubmission.objects.get(pk=response.data['id']).resulting_exercise
        self.assertEqual(exercise.licence, 'cc-by-sa-4.0')
        self.assertEqual(exercise.translations.get().licence, 'cc-by-sa-4.0')
        self.assertEqual(exercise.entries.get(kind='solution').licence, 'cc-by-sa-4.0')
        # And the API says so, on the list and the detail.
        self.client.force_authenticate(None)
        detail = self.client.get(f'/api/exercises/{exercise.pk}/').data
        self.assertEqual(detail['licence'], 'cc-by-sa-4.0')
        self.assertEqual(detail['text_licence'], 'cc-by-sa-4.0')

    def test_no_choice_is_edmat_only(self):
        response = self._post()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['payload']['licence'], 'edmat-only')

    def test_unknown_and_stray_keys_are_refused(self):
        self.assertEqual(self._post(licence='unknown').status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self._post(licence='gpl-3.0').status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_hand_edited_payload_cannot_publish_unknown(self):
        submission = ExerciseSubmission.objects.create(
            branch=self.branch,
            submitted_by=self.student,
            payload={'difficulty': 'easy', 'locale': 'pl', 'title': 'T', 'statement': 'S', 'licence': 'unknown'},
        )
        self._approve(submission.pk)
        submission.refresh_from_db()
        self.assertEqual(submission.resulting_exercise.licence, 'edmat-only')


class TranslationDerivativeTests(TestCase):
    def test_a_translation_keeps_the_licence_it_was_written_under(self):
        branch = make_branch('tr-branch')
        author = make_viewer('tr-author')
        translator = make_viewer('tr-translator')
        exercise = make_exercise(branch, 1)
        Exercise.objects.filter(pk=exercise.pk).update(submitted_by=author, licence='cc-by-sa-4.0')
        exercise.refresh_from_db()
        ExerciseTranslation.objects.filter(exercise=exercise).update(licence='cc-by-sa-4.0')
        english = ExerciseTranslation.objects.create(
            exercise=exercise, locale='en', title='T', statement='S', status='published', translated_by=translator
        )
        self.assertEqual(english.licence, 'cc-by-sa-4.0')

        from licensing.rules import change_licence

        author_account = make_user('tr-author-login')
        Exercise.objects.filter(pk=exercise.pk).update(submitted_by=author_account)
        exercise.refresh_from_db()
        self.assertIsNone(change_licence(exercise, 'cc-by-4.0', author_account))
        english.refresh_from_db()
        self.assertEqual(english.licence, 'cc-by-sa-4.0', 'the translator chose SA; only they widen it')
        self.assertEqual(ExerciseTranslation.objects.get(exercise=exercise, locale='pl').licence, 'cc-by-4.0')


class LicenceChangeEndpointTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch('chg-branch')
        self.author = make_user('chg-author')
        self.stranger = make_user('chg-stranger')
        self.staff = make_user('chg-staff', is_staff=True)
        self.exercise = make_exercise(self.branch, 1)
        Exercise.objects.filter(pk=self.exercise.pk).update(submitted_by=self.author)
        self.exercise.refresh_from_db()
        self.url = f'/api/licences/exercise/{self.exercise.pk}/'

    def post(self, user, licence, note=''):
        self.client.force_authenticate(user)
        return self.client.post(self.url, {'licence': licence, 'note': note}, format='json')

    def test_anyone_reads_it_and_the_author_sees_what_they_may_choose(self):
        anonymous = self.client.get(self.url).data
        self.assertEqual(anonymous['licence'], 'edmat-only')
        self.assertFalse(anonymous['can_change'])
        self.assertEqual(anonymous['allowed'], [])
        self.client.force_authenticate(self.author)
        mine = self.client.get(self.url).data
        self.assertTrue(mine['can_change'])
        self.assertNotIn('unknown', mine['allowed'])
        self.assertIn('cc-by-sa-4.0', mine['allowed'])

    def test_the_author_widens_and_the_change_is_recorded_with_its_date(self):
        response = self.post(self.author, 'cc-by-sa-4.0')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['licence'], 'cc-by-sa-4.0')
        row = LicenceChange.objects.get()
        self.assertEqual((row.from_licence, row.to_licence, row.changed_by, row.as_staff), ('edmat-only', 'cc-by-sa-4.0', self.author, False))
        self.exercise.refresh_from_db()
        self.assertEqual(licence_since(self.exercise), row.changed_at)
        self.assertEqual(response.data['history'][0]['to'], 'cc-by-sa-4.0')

    def test_narrowing_is_refused_with_its_reason(self):
        self.post(self.author, 'cc-by-4.0')
        response = self.post(self.author, 'cc-by-sa-4.0')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'licence_narrowing')
        self.assertEqual(self.post(self.author, 'edmat-only').data['detail'], 'licence_narrowing')

    def test_a_stranger_is_refused_and_a_person_cannot_pick_unknown(self):
        self.assertEqual(self.post(self.stranger, 'cc-by-4.0').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.post(self.author, 'unknown').data['detail'], 'licence_not_selectable')
        self.assertEqual(self.post(self.author, 'edmat-only').data['detail'], 'licence_unchanged')

    def test_staff_mark_rights_unknown_with_a_reason_and_clear_them_again(self):
        self.assertEqual(self.post(self.staff, 'unknown').data['detail'], 'licence_note_required')
        self.assertEqual(self.post(self.staff, 'unknown', 'copied from a textbook').status_code, status.HTTP_200_OK)
        self.assertEqual(self.post(self.staff, 'cc-by-4.0', 'holder granted it in writing').status_code, status.HTTP_200_OK)
        self.assertEqual(LicenceChange.objects.filter(as_staff=True).count(), 2)

    def test_an_unpublished_item_is_404_to_a_stranger(self):
        Exercise.objects.filter(pk=self.exercise.pk).update(published=False)
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_404_NOT_FOUND)
        self.client.force_authenticate(self.author)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_200_OK)

    def test_an_unknown_kind_is_404(self):
        self.assertEqual(self.client.get(f'/api/licences/comment/{self.exercise.pk}/').status_code, 404)

    def test_a_material_with_another_persons_version_cannot_be_relicensed(self):
        from coauthoring.models import MaterialProject, MaterialVersion, ProjectMember

        material = make_material(self.branch, 'chg-material')
        Material.objects.filter(pk=material.pk).update(submitted_by=self.author)
        material.refresh_from_db()
        project = MaterialProject.objects.create(material=material, branch=self.branch, created_by=self.author)
        coauthor = make_viewer('chg-coauthor')
        ProjectMember.objects.create(project=project, user=coauthor, role='coauthor')
        MaterialVersion.objects.create(project=project, number=1, status='superseded', title='v1', created_by=self.author)
        MaterialVersion.objects.create(project=project, number=2, status='published', title='v2', created_by=coauthor)
        self.client.force_authenticate(self.author)
        response = self.client.post(f'/api/licences/material/{material.pk}/', {'licence': 'cc-by-4.0'}, format='json')
        self.assertEqual(response.data['detail'], 'licence_other_contributors')


class ImporterLicenceTests(TestCase):
    def setUp(self):
        self.branch = make_branch('imp-licence-branch')
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, licence_line=''):
        body = f"""
            ---
            number: 3
            title: Licencja
            difficulty: easy
            {licence_line}
            ---
            ## Treść
            Policz \\(1+1\\).
            ## Rozwiązanie
            Dwa.
            """
        (self.dir / '0003.md').write_text(dedent(body).lstrip(), encoding='utf-8')

    def run_import(self, **kwargs):
        out = StringIO()
        call_command('import_exercises', str(self.dir), branch=self.branch.slug, stdout=out, stderr=out, **kwargs)
        return out.getvalue()

    def test_no_licence_anywhere_is_unknown(self):
        self.write()
        self.run_import()
        exercise = Exercise.objects.get(branch=self.branch, number=3)
        self.assertEqual(exercise.licence, 'unknown')
        self.assertEqual(exercise.entries.get().licence, 'unknown')

    def test_the_file_key_is_used_and_a_stray_key_is_refused(self):
        self.write('licence: cc-by-4.0')
        self.run_import()
        self.assertEqual(Exercise.objects.get(branch=self.branch, number=3).licence, 'cc-by-4.0')
        self.write('licence: wtfpl')
        with self.assertRaises(CommandError):
            self.run_import()

    def test_the_flag_is_the_default_for_files_that_do_not_say(self):
        self.write()
        self.run_import(licence='cc-by-sa-4.0')
        self.assertEqual(Exercise.objects.get(branch=self.branch, number=3).licence, 'cc-by-sa-4.0')

    def test_a_re_run_widens_and_records_but_never_narrows(self):
        self.write()
        self.run_import()
        self.write('licence: cc-by-sa-4.0')
        self.run_import()
        exercise = Exercise.objects.get(branch=self.branch, number=3)
        self.assertEqual(exercise.licence, 'cc-by-sa-4.0')
        self.assertEqual(exercise.entries.get().licence, 'cc-by-sa-4.0')
        self.assertEqual(LicenceChange.objects.get().to_licence, 'cc-by-sa-4.0')
        self.write('licence: edmat-only')
        output = self.run_import()
        self.assertIn('narrower', output)
        self.assertEqual(Exercise.objects.get(pk=exercise.pk).licence, 'cc-by-sa-4.0')


class CreationPathTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        cache.clear()
        self.branch = make_branch('create-licence-branch')
        self.user = make_user('create-licence-user')
        self.exercise = make_exercise(self.branch, 1)

    def test_a_solution_carries_its_own_choice_and_refuses_unknown(self):
        self.client.force_authenticate(self.user)
        url = f'/api/exercises/{self.exercise.pk}/entries/'
        ok = self.client.post(url, {'kind': 'solution', 'locale': 'pl', 'body': 'Mine.', 'licence': 'cc0-1.0'}, format='json')
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)
        self.assertEqual(SolutionEntry.objects.get(pk=ok.data['id']).licence, 'cc0-1.0')
        default = self.client.post(url, {'kind': 'hint', 'locale': 'pl', 'body': 'Hint.'}, format='json')
        self.assertEqual(SolutionEntry.objects.get(pk=default.data['id']).licence, 'edmat-only')
        refused = self.client.post(url, {'kind': 'hint', 'locale': 'pl', 'body': 'Hint.', 'licence': 'unknown'}, format='json')
        self.assertEqual(refused.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_concept_article_takes_its_authors_choice(self):
        from concepts.services import create_concept

        _concept, article, _revision = create_concept(
            self.user, title='Granica', audience='university', locale='pl', licence='cc-by-4.0'
        )
        self.assertEqual(article.licence, 'cc-by-4.0')
        from concepts.serializers import ConceptCreateSerializer

        serializer = ConceptCreateSerializer(
            data={'title': 'X', 'audience': 'university', 'locale': 'pl', 'licence': 'unknown'},
            context={},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('licence', serializer.errors)

    def test_the_exercise_list_filters_by_licence(self):
        other = make_exercise(self.branch, 2)
        Exercise.objects.filter(pk=other.pk).update(licence='cc-by-4.0')
        rows = self.client.get(f'/api/exercises/?branch={self.branch.slug}&licence=cc-by-4.0').data
        self.assertEqual([row['id'] for row in rows], [other.pk])
        self.assertEqual(rows[0]['licence'], 'cc-by-4.0')


from coauthoring.test_submit_path import SubmitPathBase  # noqa: E402 — a base class, imported where used


class MaterialSubmitLicenceTests(SubmitPathBase):
    def test_the_projects_choice_becomes_the_materials_licence(self):
        self.client.force_authenticate(self.student)
        response = self.submit(licence='cc-by-nc-4.0')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.json()['licence'], 'cc-by-nc-4.0')
        self.assertEqual(self.decide(self.head_id(response), 'accept').status_code, status.HTTP_200_OK)
        material = Material.objects.get(project__pk=response.json()['id'])
        self.assertEqual(material.licence, 'cc-by-nc-4.0')

    def test_unknown_is_refused(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.submit(licence='unknown').status_code, status.HTTP_400_BAD_REQUEST)

    def test_no_choice_is_edmat_only_even_for_a_text_written_here(self):
        """The CC BY suggestion (owner, 2026-10-14) is the FORM's pre-selection only: an API client
        that sends no licence opens nothing, whatever the material is."""
        self.client.force_authenticate(self.student)
        response = self.submit(file=None, kind='body', body='Written here from scratch.')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.json()['licence'], 'edmat-only')


class RelicenseCommandTests(TestCase):
    """`manage.py relicense_content` (2026-10-21): the bulk move goes through the rules and adds no
    authority of its own — `unknown` moves (the staff exception), the caller's own content moves,
    another person's `edmat-only` is refused and listed, what is already as open stays, nothing
    unpublished is touched, and a dry run changes nothing."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch('rel-branch')
        self.staff = make_user('rel-staff', is_staff=True)
        self.author = make_user('rel-author')
        self.corpus = make_exercise(self.branch, 1)  # unknown, nobody's
        Exercise.objects.filter(pk=self.corpus.pk).update(licence='unknown')
        ExerciseTranslation.objects.filter(exercise=self.corpus).update(licence='unknown')
        self.entry = SolutionEntry.objects.create(
            exercise=self.corpus, kind='solution', body='x', status='published', licence='unknown'
        )
        self.theirs = make_exercise(self.branch, 2)  # a person's edmat-only
        Exercise.objects.filter(pk=self.theirs.pk).update(submitted_by=self.author)
        self.mine = make_exercise(self.branch, 3)  # the staff caller's own edmat-only
        Exercise.objects.filter(pk=self.mine.pk).update(submitted_by=self.staff)
        self.wider = make_exercise(self.branch, 4)
        Exercise.objects.filter(pk=self.wider.pk).update(licence='cc-by-4.0')
        self.hidden = make_exercise(self.branch, 5)
        Exercise.objects.filter(pk=self.hidden.pk).update(licence='unknown', published=False)

    def run_it(self, **kwargs):
        out = StringIO()
        call_command('relicense_content', to='cc-by-sa-4.0', by='rel-staff', note='Cleared with the faculty', stdout=out, **kwargs)
        return out.getvalue()

    def licences(self):
        return {
            e.number: e.licence for e in Exercise.objects.filter(branch=self.branch).order_by('number')
        }

    def test_a_dry_run_reports_and_changes_nothing(self):
        out = self.run_it(dry_run=True)
        self.assertIn('rolling the transaction back', out)
        self.assertIn('exercise: 2 changed (1 from edmat-only, 1 from unknown); 1 already as open or more; 1 refused', out)
        self.assertIn(f'licence_other_contributors (1): {self.theirs.pk}', out)
        self.assertEqual(self.licences(), {1: 'unknown', 2: 'edmat-only', 3: 'edmat-only', 4: 'cc-by-4.0', 5: 'unknown'})
        self.assertEqual(LicenceChange.objects.count(), 0)

    def test_the_real_run_moves_what_the_rules_allow_and_records_every_change(self):
        out = self.run_it()
        self.assertIn('solution_entry: 1 changed (1 from unknown)', out)
        self.assertIn('3 changed to cc-by-sa-4.0', out)
        self.assertEqual(self.licences(), {1: 'cc-by-sa-4.0', 2: 'edmat-only', 3: 'cc-by-sa-4.0', 4: 'cc-by-4.0', 5: 'unknown'})
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.licence, 'cc-by-sa-4.0')
        # the corpus exercise's own-language text follows it (rules._carry_to_own_text)
        self.assertEqual(ExerciseTranslation.objects.get(exercise=self.corpus).licence, 'cc-by-sa-4.0')
        rows = LicenceChange.objects.order_by('id')
        self.assertEqual(rows.count(), 3)
        self.assertTrue(all(r.note == 'Cleared with the faculty' and r.changed_by == self.staff for r in rows))
        self.assertEqual({r.as_staff for r in rows.filter(object_id__in=[self.corpus.pk, self.entry.pk])}, {True})
        own = rows.get(content_type__model='exercise', object_id=self.mine.pk)
        self.assertFalse(own.as_staff)
        # a second run finds nothing left to move and refuses the same item again
        again = self.run_it()
        self.assertIn('0 changed to cc-by-sa-4.0', again)
        self.assertEqual(LicenceChange.objects.count(), 3)

    def test_author_narrows_the_walk_to_that_accounts_content(self):
        # rel-author's exercise is unknown here (an imported one credited to a person) — the staff
        # exception moves it; the nobody's corpus row and the staff caller's own stay put
        Exercise.objects.filter(pk=self.theirs.pk).update(licence='unknown')
        # the corpus's own (authorless) solution on rel-author's exercise goes with it; one written by
        # somebody else on the same exercise does not
        orphan = SolutionEntry.objects.create(
            exercise=self.theirs, kind='solution', body='o', status='published', licence='unknown'
        )
        other = SolutionEntry.objects.create(
            exercise=self.theirs, kind='solution', body='s', status='published', licence='unknown', author=self.staff
        )
        out = StringIO()
        call_command(
            'relicense_content', to='cc-by-nc-4.0', by='rel-staff', note='Agreed with the author',
            author='rel-author', stdout=out,
        )
        self.assertIn('exercise: 1 changed (1 from unknown); 0 already as open or more; 0 refused', out.getvalue())
        self.assertIn('solution_entry: 1 changed (1 from unknown)', out.getvalue())
        orphan.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual((orphan.licence, other.licence), ('cc-by-nc-4.0', 'unknown'))
        self.assertEqual(self.licences(), {1: 'unknown', 2: 'cc-by-nc-4.0', 3: 'edmat-only', 4: 'cc-by-4.0', 5: 'unknown'})
        # a later CC BY-SA sweep cannot turn BY-NC into BY-SA: the two are incomparable
        swept = self.run_it()
        self.assertIn('licence_narrowing (1): ' + str(self.theirs.pk), swept)
        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.licence, 'cc-by-nc-4.0')
        with self.assertRaises(CommandError):
            call_command('relicense_content', to='cc-by-nc-4.0', by='rel-staff', note='x', author='nobody', stdout=StringIO())

    def test_it_refuses_a_narrowing_target_a_missing_note_and_a_non_staff_caller(self):
        with self.assertRaises(CommandError):
            call_command('relicense_content', to='unknown', by='rel-staff', note='x', stdout=StringIO())
        with self.assertRaises(CommandError):
            call_command('relicense_content', to='edmat-only', by='rel-staff', note='x', stdout=StringIO())
        with self.assertRaises(CommandError):
            call_command('relicense_content', to='cc-by-sa-4.0', by='rel-staff', stdout=StringIO())
        with self.assertRaises(CommandError):
            call_command('relicense_content', to='cc-by-sa-4.0', by='rel-author', note='x', stdout=StringIO())
        self.assertEqual(LicenceChange.objects.count(), 0)
