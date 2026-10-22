"""`POST /api/exercise-imports/` — a person's bulk upload of exercise files (`exercises/bulk.py`,
2026-10-22).

The two paths (a verified contributor publishes at once, everybody else queues), the moderator's
batch approve, the parser the operator's command shares, and the adversarial files: oversize, too
many, a traversal filename, a `!!python` tag and an alias bomb, `<script>`/`onerror`, a `number:`
that names an existing exercise, a topic of another branch, `unknown` and `published: false`.
"""

from __future__ import annotations

from textwrap import dedent

from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from exercises import bulk
from exercises.models import Exercise, ExercisePart, ExerciseTranslation, SolutionEntry
from moderation.models import ExerciseSubmission, FeatureFlag, NodeGovernor
from provenance.models import AuthorMark
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_topic, make_user

URL = '/api/exercise-imports/'


def md(text: str) -> str:
    return dedent(text).lstrip()


GOOD = md("""
    ---
    title: Pochodna złożenia
    difficulty: średnie
    topics: [pochodne]
    tags: [pochodna]
    ---
    ## Treść
    Policz pochodną \\(f(x)=\\sin(x^2)\\).

    ## Wskazówka
    Reguła łańcuchowa.

    ## Odpowiedź
    \\(2x\\cos(x^2)\\)

    ## Rozwiązanie
    \\(f'(x)=\\cos(x^2)\\cdot 2x\\).
""")

WITH_PARTS = md("""
    ---
    title: Liczby zespolone
    difficulty: łatwe
    ---
    ## Treść
    Przedstaw w postaci \\(a+bi\\):

    ## Podpunkt a

    ## Treść
    \\((1-i)^2\\)

    ## Odpowiedź
    \\(-2i\\)

    ## Rozwiązanie
    \\(1-2i+i^2=-2i\\).

    ## Podpunkt b

    ## Treść
    \\(\\frac{1}{i}\\)

    ## Odpowiedź
    \\(-i\\)
""")


def upload(name: str, text: str | bytes) -> SimpleUploadedFile:
    data = text if isinstance(text, bytes) else text.encode('utf-8')
    return SimpleUploadedFile(name, data, content_type='text/markdown')


class _Base(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        cache.clear()  # the throttle counters
        self.branch = make_branch('bulk-branch')
        self.topic = make_topic(self.branch, 'pochodne')
        self.other = make_branch('bulk-other')
        make_topic(self.other, 'obca')
        self.person = make_user('bulk-person')
        self.verified = make_user('bulk-verified', is_verified_contributor=True)
        self.staff = make_user('bulk-staff', is_staff=True)

    def send(self, user, files, mode='preview', **fields):
        self.client.force_authenticate(user)
        data = {'branch': self.branch.slug, 'files': files, **fields}
        return self.client.post(f'{URL}?mode={mode}', data, format='multipart')

    def codes(self, response, index=0):
        return [e['code'] for e in response.data['files'][index]['errors']]


class PreviewTests(_Base):
    def test_a_clean_preview_writes_nothing_and_says_where_it_would_go(self):
        response = self.send(self.person, [upload('a.md', GOOD), upload('b.md', WITH_PARTS)])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['ok'])
        self.assertEqual(response.data['mode'], 'queue')
        self.assertEqual([f['name'] for f in response.data['files']], ['a.md', 'b.md'])
        self.assertEqual(response.data['files'][1]['parts'], 2)
        self.assertEqual(ExerciseSubmission.objects.count(), 0)
        self.assertEqual(Exercise.objects.filter(branch=self.branch).count(), 0)
        self.assertEqual(self.send(self.verified, [upload('a.md', GOOD)]).data['mode'], 'publish')

    def test_signed_out_is_refused(self):
        self.client.force_authenticate(None)
        response = self.client.post(f'{URL}?mode=preview', {'branch': self.branch.slug}, format='multipart')
        self.assertIn(response.status_code, (401, 403))

    def test_both_switches_close_it_for_a_person_but_not_for_staff(self):
        for key in ('exercise_bulk_upload', 'exercise_submissions'):
            FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': False})
            self.assertEqual(self.send(self.person, [upload('a.md', GOOD)]).status_code, 403)
            self.assertEqual(self.send(self.staff, [upload('a.md', GOOD)]).status_code, 200)
            FeatureFlag.objects.filter(key=key).update(is_enabled=True)

    def test_every_refusal_carries_its_word(self):
        unknown = GOOD.replace('difficulty: średnie', 'difficulty: średnie\nlicence: unknown')
        hidden = GOOD.replace('difficulty: średnie', 'difficulty: średnie\npublished: false')
        foreign = GOOD.replace('topics: [pochodne]', 'topics: [obca]')
        bad_heading = GOOD.replace('## Wskazówka', '## Uwagi')
        response = self.send(self.person, [
            upload('unknown.md', unknown), upload('hidden.md', hidden), upload('foreign.md', foreign),
            upload('heading.md', bad_heading), upload('notes.txt', GOOD), upload('latin.md', 'tytuł'.encode('cp1250')),
        ])
        self.assertFalse(response.data['ok'])
        self.assertIn('licence_not_selectable', self.codes(response, 0))
        self.assertIn('published_false', self.codes(response, 1))
        self.assertEqual(self.codes(response, 2), ['topic_not_in_branch'])
        self.assertIn('format', self.codes(response, 3))
        self.assertEqual(self.codes(response, 4), ['not_markdown'])
        self.assertEqual(self.codes(response, 5), ['not_utf8'])

    def test_a_branch_that_does_not_exist_or_is_not_approved(self):
        self.client.force_authenticate(self.person)
        response = self.client.post(f'{URL}?mode=preview', {'branch': 'nope', 'files': [upload('a.md', GOOD)]}, format='multipart')
        self.assertEqual([e['code'] for e in response.data['errors']], ['branch_not_found'])
        self.branch.status = 'pending'
        self.branch.save(update_fields=['status'])
        self.assertIn('branch_not_found', [e['code'] for e in self.send(self.person, [upload('a.md', GOOD)]).data['errors']])

    def test_oversize_files_too_many_files_and_an_oversized_body(self):
        big = GOOD + ('x' * (bulk.MAX_FILE_BYTES + 10))
        self.assertEqual(self.codes(self.send(self.person, [upload('big.md', big)])), ['file_too_large'])
        many = [upload(f'{i}.md', GOOD) for i in range(bulk.MAX_FILES + 1)]
        response = self.send(self.person, many)
        self.assertEqual([e['code'] for e in response.data['errors']], ['too_many_files'])
        self.client.force_authenticate(self.person)
        response = self.client.post(
            f'{URL}?mode=preview', {'branch': self.branch.slug}, format='multipart',
            CONTENT_LENGTH=str(bulk.MAX_TOTAL_BYTES * 2),
        )
        self.assertEqual(response.status_code, 413)

    def test_a_traversal_filename_is_only_ever_a_name_to_show(self):
        response = self.send(self.person, [upload('../../etc/passwd.md', GOOD)])
        self.assertEqual(response.data['files'][0]['name'], 'passwd.md')
        self.assertTrue(response.data['ok'])
        self.assertEqual(bulk.display_name('C:\\Users\\x\\..\\zad\u202e1.md'), 'zad1.md')

    def test_yaml_python_tags_and_aliases_are_refused(self):
        python_tag = GOOD.replace('title: Pochodna złożenia', 'title: !!python/object/apply:os.system ["true"]')
        bomb = GOOD.replace('title: Pochodna złożenia', 'a: &a [x, x]\nb: &b [*a, *a]\ntitle: *b')
        response = self.send(self.person, [upload('py.md', python_tag), upload('bomb.md', bomb)])
        self.assertIn('format', self.codes(response, 0))
        self.assertIn('format', self.codes(response, 1))
        self.assertTrue(any('YAML' in e['detail'] for e in response.data['files'][1]['errors']))

    def test_a_mapping_where_a_value_belongs(self):
        bad = GOOD.replace('title: Pochodna złożenia', 'title: {nested: true}')
        self.assertIn('value_type', self.codes(self.send(self.person, [upload('t.md', bad)])))

    def test_a_number_is_ignored_with_a_warning_never_a_key(self):
        existing = make_exercise(self.branch, 7)
        numbered = GOOD.replace('title: Pochodna złożenia', 'number: 7\ntitle: Inny tytuł')
        response = self.send(self.verified, [upload('n.md', numbered)], mode='commit')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual([w['code'] for w in response.data['files'][0]['warnings']], ['number_ignored'])
        self.assertNotEqual(
            ExerciseTranslation.objects.get(exercise=existing, status='published').title, 'Inny tytuł'
        )
        created = Exercise.objects.get(pk=response.data['created'][0]['exercise'])
        self.assertEqual(created.number, 8)

    def test_html_the_sanitizer_will_cut_is_reported_and_cut(self):
        nasty = GOOD.replace(
            'Policz pochodną', '<script>alert(1)</script><img src=x onerror="alert(2)">Policz pochodną'
        )
        response = self.send(self.person, [upload('x.md', nasty)])
        self.assertEqual([w['code'] for w in response.data['files'][0]['warnings']], ['html_removed'])
        response = self.send(self.person, [upload('x.md', nasty)], mode='commit')
        self.assertEqual(response.status_code, 201, response.data)
        payload = ExerciseSubmission.objects.get().payload
        self.assertNotIn('<script', payload['statement'])
        self.assertNotIn('onerror', payload['statement'])
        self.assertIn('\\(f(x)=\\sin(x^2)\\)', payload['statement'])


class CommitTests(_Base):
    def test_a_person_queues_one_submission_per_file_in_one_batch(self):
        response = self.send(self.person, [upload('a.md', GOOD), upload('b.md', WITH_PARTS)], mode='commit')
        self.assertEqual(response.status_code, 201, response.data)
        rows = ExerciseSubmission.objects.order_by('pk')
        self.assertEqual([r.status for r in rows], ['pending', 'pending'])
        self.assertEqual(len({r.upload_batch for r in rows}), 1)
        self.assertEqual(rows[0].payload['topicIds'], [str(self.topic.pk)])
        self.assertEqual(rows[0].payload['licence'], 'edmat-only')
        self.assertEqual(len(rows[1].payload['parts']), 2)
        self.assertEqual(Exercise.objects.filter(branch=self.branch).count(), 0)

    def test_one_bad_file_refuses_the_whole_commit(self):
        response = self.send(
            self.person, [upload('a.md', GOOD), upload('b.md', GOOD.replace('## Treść', '## Coś'))], mode='commit'
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.data['ok'])
        self.assertEqual(ExerciseSubmission.objects.count(), 0)

    def test_a_verified_contributor_publishes_with_parts_licence_and_the_ai_mark(self):
        response = self.send(
            self.verified, [upload('a.md', GOOD), upload('b.md', WITH_PARTS)], mode='commit',
            licence='cc-by-4.0', ai_assisted='true',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual([r['status'] for r in response.data['created']], ['approved', 'approved'])
        one = Exercise.objects.get(pk=response.data['created'][0]['exercise'])
        two = Exercise.objects.get(pk=response.data['created'][1]['exercise'])
        self.assertEqual((one.submitted_by, one.licence, one.published), (self.verified, 'cc-by-4.0', True))
        self.assertEqual(list(one.topics.values_list('slug', flat=True)), ['pochodne'])
        self.assertEqual(list(one.tags.values_list('slug', flat=True)), ['pochodna'])
        self.assertEqual(SolutionEntry.objects.filter(exercise=one).count(), 2)
        parts = list(ExercisePart.objects.filter(exercise=two).order_by('order'))
        self.assertEqual([p.label for p in parts], ['a', 'b'])
        self.assertEqual(SolutionEntry.objects.filter(exercise=two, part=parts[0], kind='solution').count(), 1)
        self.assertFalse(SolutionEntry.objects.filter(exercise=two, part__isnull=False, pinned=True).exists())
        ct = ContentType.objects.get_for_model(Exercise)
        self.assertTrue(AuthorMark.objects.get(content_type=ct, object_id=one.pk).assisted)
        # an AI-assisted solution does not count until reviewed (provenance/), so neither is verified
        one.refresh_from_db()
        self.assertFalse(one.verified)

    def test_without_the_ai_mark_a_verified_authors_solution_verifies(self):
        response = self.send(self.verified, [upload('a.md', GOOD)], mode='commit')
        one = Exercise.objects.get(pk=response.data['created'][0]['exercise'])
        self.assertTrue(one.verified)
        self.assertFalse(AuthorMark.objects.exists())

    def test_a_minor_reuses_tags_but_mints_none(self):
        self.person.profile.is_minor = True
        self.person.profile.save()
        new_tag = GOOD.replace('tags: [pochodna]', 'tags: [zupelnie-nowy-tag]')
        response = self.send(self.person, [upload('a.md', new_tag)])
        self.assertIn('tag_refused', self.codes(response))

    def test_the_commit_throttle_counts(self):
        from unittest import mock

        from exercises.bulk_views import BulkCommitThrottle

        with mock.patch.object(BulkCommitThrottle, 'THROTTLE_RATES', {'exercise_bulk_commit': '1/hour'}):
            self.assertEqual(self.send(self.person, [upload('a.md', GOOD)], mode='commit').status_code, 201)
            self.assertEqual(self.send(self.person, [upload('a.md', GOOD)], mode='commit').status_code, 429)
            # a preview spends the other budget, not this one
            self.assertEqual(self.send(self.person, [upload('a.md', GOOD)]).status_code, 200)


class BatchApproveTests(_Base):
    def setUp(self):
        super().setUp()
        self.send(self.person, [upload('a.md', GOOD), upload('b.md', WITH_PARTS)], mode='commit')
        self.batch = ExerciseSubmission.objects.first().upload_batch

    def test_a_moderator_approves_the_whole_batch_once(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(f'/api/moderation/batches/{self.batch}/approve/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['approved']), 2)
        self.assertEqual(set(ExerciseSubmission.objects.values_list('status', flat=True)), {'approved'})
        two = Exercise.objects.get(pk=response.data['approved'][1]['exercise'])
        # a moderator approved it, so the founding entries are pinned — parts' too
        self.assertTrue(SolutionEntry.objects.filter(exercise=two, part__isnull=False, pinned=True).exists())
        again = self.client.post(f'/api/moderation/batches/{self.batch}/approve/', {}, format='json')
        self.assertEqual(again.data['approved'], [])
        self.assertEqual(Exercise.objects.filter(branch=self.branch).count(), 2)

    def test_a_governor_of_another_branch_approves_nothing_and_a_stranger_is_refused(self):
        governor = make_user('bulk-governor')
        NodeGovernor.objects.create(
            user=governor, content_type=ContentType.objects.get_for_model(type(self.other)), object_id=self.other.pk
        )
        self.client.force_authenticate(governor)
        response = self.client.post(f'/api/moderation/batches/{self.batch}/approve/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual({s['reason'] for s in response.data['skipped']}, {'not_governor'})
        self.client.force_authenticate(self.person)
        self.assertEqual(
            self.client.post(f'/api/moderation/batches/{self.batch}/approve/', {}, format='json').status_code, 403
        )

    def test_an_unknown_batch_is_404(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.post('/api/moderation/batches/' + '0' * 32 + '/approve/').status_code, 404)
        self.assertEqual(self.client.post('/api/moderation/batches/nope/approve/').status_code, 404)


class SubmitDraftShapeTests(_Base):
    """`/submit`'s serializer holds a hand-built draft to the shape `_apply_submission` now reads."""

    def test_bad_parts_and_a_non_boolean_mark_are_refused_and_bulk_is_stripped(self):
        self.client.force_authenticate(self.person)
        base = {'title': 't', 'statement': 's', 'difficulty': 'easy'}
        for bad in ([{'label': '', 'statement': 'x'}], [{'label': 'a', 'statement': 'x', 'evil': 1}], 'no'):
            response = self.client.post(
                '/api/exercise-submissions/', {'branch': self.branch.slug, 'payload': {**base, 'parts': bad}}, format='json'
            )
            self.assertEqual(response.status_code, 400, bad)
        response = self.client.post(
            '/api/exercise-submissions/', {'branch': self.branch.slug, 'payload': {**base, 'ai_assisted': 'yes'}}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            '/api/exercise-submissions/',
            {'branch': self.branch.slug, 'payload': {**base, 'bulk': {'batch': 'x'}}},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('bulk', ExerciseSubmission.objects.get().payload)
