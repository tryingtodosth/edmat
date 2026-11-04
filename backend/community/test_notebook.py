"""Notebook content and comments on a block (2026-11-04, `HISTORY.md` §17DI).

- `BlockModuleTests` — `config/blocks.py` on its own: ids kept, allocated and re-rolled; kinds,
  lengths and references refused with a reason; the derived body; the query count of a thread.
- `NotebookCommentTests` — a comment written as blocks through a real thread endpoint: the body
  derived, a one-paragraph notebook collapsing into a plain comment, an edit keeping block ids,
  the history keeping the notebook, the tombstone blanking it, and the minor-band picture hold.
- `AnchorTests` — `community/anchors.py`: a top-level comment on a sentence of an exercise's
  statement, a reply on one block of its parent, every refusal word, `detached` after the block is
  deleted, and a removed parent's words not surviving in its replies' quotes.
- `SolutionAndPostNotebookTests` — the same list on a solution entry and on a board post (JSON and
  multipart), and a comment anchored to one step of a notebook solution.
"""

from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APITestCase

from config.blocks import (
    COMMENT_PROFILE,
    clean_blocks,
    expand_blocks,
    flatten,
    prefetch,
)
from exercises.models import Exercise, SolutionEntry
from sketches.models import Sketch
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user

from .models import Comment


def sketch(author, label='free-body diagram'):
    return Sketch.objects.create(
        author=author, source='{"elements":[]}', label=label, image='sketches/x.webp', width=40, height=30
    )


class BlockModuleTests(TestCase):
    def setUp(self):
        self.author = make_user('nb-module')

    def test_a_block_without_an_id_gets_one_and_a_good_id_is_kept(self):
        cleaned = clean_blocks(
            [{'kind': 'markdown', 'body': 'a'}, {'id': 'keepme12', 'kind': 'latex', 'source': 'x'}],
            profile=COMMENT_PROFILE,
        )
        self.assertRegex(cleaned[0]['id'], r'^[a-z0-9]{8}$')
        self.assertEqual(cleaned[1]['id'], 'keepme12')

    def test_a_duplicate_id_keeps_the_first_and_rerolls_the_copy(self):
        cleaned = clean_blocks(
            [{'id': 'same1234', 'kind': 'markdown', 'body': 'a'}, {'id': 'same1234', 'kind': 'markdown', 'body': 'b'}],
            profile=COMMENT_PROFILE,
        )
        self.assertEqual(cleaned[0]['id'], 'same1234')
        self.assertNotEqual(cleaned[1]['id'], 'same1234')

    def test_a_malformed_id_is_replaced_not_refused(self):
        cleaned = clean_blocks([{'id': 'Bad Id!<x>', 'kind': 'markdown', 'body': 'a'}], profile=COMMENT_PROFILE)
        self.assertRegex(cleaned[0]['id'], r'^[a-z0-9]{8}$')

    def test_refusals_carry_a_blocks_key(self):
        for raw in (
            'not a list',
            [{'kind': 'video'}],
            [{'kind': 'latex', 'source': '  '}],
            [{'kind': 'code', 'source': 'x', 'language': 'Not A Language'}],
            [{'kind': 'sketch', 'sketch_id': 987654}],
            [{'kind': 'image', 'image_id': 'abc'}],
            [{'kind': 'markdown', 'body': 'x'}] * 41,
            [{'kind': 'code', 'source': 'x' * 20_000}, {'kind': 'code', 'source': 'y' * 11_000}],
        ):
            with self.subTest(raw=str(raw)[:60]), self.assertRaises(ValidationError) as caught:
                clean_blocks(raw, profile=COMMENT_PROFILE)
            self.assertIn('blocks', caught.exception.message_dict)

    def test_code_and_formulas_are_stored_raw_and_paragraphs_sanitized(self):
        cleaned = clean_blocks(
            [
                {'kind': 'code', 'language': 'python', 'source': 'if a < b and c > d:\n    print("<b>")'},
                {'kind': 'latex', 'source': r'\frac{a}{b} < c'},
                {'kind': 'markdown', 'body': 'hi <script>alert(1)</script>'},
            ],
            profile=COMMENT_PROFILE,
        )
        self.assertEqual(cleaned[0]['source'], 'if a < b and c > d:\n    print("<b>")')
        self.assertEqual(cleaned[1]['source'], r'\frac{a}{b} < c')
        self.assertNotIn('<script', cleaned[2]['body'])

    def test_the_derived_body_names_pictures_and_fences_code_safely(self):
        drawing = sketch(self.author)
        blocks = clean_blocks(
            [
                {'kind': 'markdown', 'body': 'Step one.'},
                {'kind': 'latex', 'source': 'x^2'},
                {'kind': 'code', 'language': 'md', 'source': 'a ``` b'},
                {'kind': 'sketch', 'sketch_id': drawing.pk, 'caption': 'the forces'},
            ],
            profile=COMMENT_PROFILE,
        )
        body = flatten(blocks, profile=COMMENT_PROFILE)
        self.assertIn('Step one.', body)
        self.assertIn('\\[x^2\\]', body)
        self.assertIn('````md\na ``` b\n````', body)
        self.assertIn('[Sketch: the forces]', body)

    def test_expanding_a_whole_thread_costs_one_query_per_referenced_table(self):
        drawing = sketch(self.author)
        notebooks = [
            [{'id': f'b{i:07d}', 'kind': 'sketch', 'sketch_id': drawing.pk, 'caption': ''}] for i in range(15)
        ]
        cache: dict = {}
        with self.assertNumQueries(1):
            prefetch(notebooks, profile=COMMENT_PROFILE, cache=cache)
            expanded = [expand_blocks(n, profile=COMMENT_PROFILE, cache=cache) for n in notebooks]
        self.assertEqual(expanded[3][0]['sketch']['id'], drawing.pk)

    def test_a_reference_that_no_longer_resolves_is_none_and_the_block_stays(self):
        expanded = expand_blocks(
            [{'id': 'gone1234', 'kind': 'sketch', 'sketch_id': 424242, 'caption': ''}], profile=COMMENT_PROFILE
        )
        self.assertEqual(len(expanded), 1)
        self.assertIsNone(expanded[0]['sketch'])


class NotebookBase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch(slug='nb-branch')
        self.exercise = make_exercise(self.branch, 1, statement='Find the maximum of f on [0, 1].')
        self.author = make_user('nb-author')
        self.other = make_user('nb-other')
        self.url = f'/api/exercises/{self.exercise.pk}/comments/'

    def post(self, user, data):
        self.client.force_authenticate(user)
        return self.client.post(self.url, data, format='json')

    def notebook(self):
        return [
            {'id': 'stepone1', 'kind': 'markdown', 'body': 'First differentiate.'},
            {'id': 'steptwo2', 'kind': 'latex', 'source': "f'(x) = 0"},
            {'id': 'stepthr3', 'kind': 'code', 'language': 'python', 'source': 'print(max(f(x) for x in xs))'},
        ]


class NotebookCommentTests(NotebookBase):
    def test_a_notebook_comment_is_stored_as_blocks_with_a_derived_body(self):
        response = self.post(self.author, {'blocks': self.notebook()})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual([b['id'] for b in response.data['blocks']], ['stepone1', 'steptwo2', 'stepthr3'])
        comment = Comment.objects.get(pk=response.data['id'])
        self.assertIn('First differentiate.', comment.body)
        self.assertIn("\\[f'(x) = 0\\]", comment.body)

    def test_a_body_or_blocks_is_required(self):
        response = self.post(self.author, {'body': '  '})
        self.assertEqual(response.status_code, 400)
        self.assertIn('body', response.data)

    def test_a_malformed_notebook_is_a_400_with_a_blocks_key(self):
        response = self.post(self.author, {'blocks': [{'kind': 'video'}]})
        self.assertEqual(response.status_code, 400)
        self.assertIn('blocks', response.data)

    def test_one_paragraph_is_a_plain_comment(self):
        response = self.post(self.author, {'blocks': [{'kind': 'markdown', 'body': 'Just words.'}]})
        self.assertEqual(response.status_code, 201)
        comment = Comment.objects.get(pk=response.data['id'])
        self.assertEqual(comment.blocks, [])
        self.assertEqual(comment.body, 'Just words.')

    def test_an_edit_keeps_block_ids_and_the_history_keeps_the_notebook(self):
        created = self.post(self.author, {'blocks': self.notebook()}).data
        edited = self.notebook()
        edited[0]['body'] = 'First, differentiate carefully.'
        response = self.client.patch(f'/api/comments/{created["id"]}/', {'blocks': edited}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['blocks'][0]['id'], 'stepone1')
        self.assertIn('carefully', response.data['body'])
        history = self.client.get(f'/api/comments/{created["id"]}/revisions/').data
        self.assertEqual(history[0]['blocks'][0]['body'], 'First differentiate.')

    def test_a_removed_notebook_comment_shows_no_blocks(self):
        created = self.post(self.author, {'blocks': self.notebook()}).data
        self.client.delete(f'/api/comments/{created["id"]}/')
        row = next(c for c in self.client.get(self.url).data if c['id'] == created['id'])
        self.assertEqual(row['blocks'], [])
        self.assertEqual(row['body'], '')

    def test_a_sketch_block_on_a_childrens_thread_is_held_like_an_inline_picture(self):
        self.exercise.audience = 'primary'
        self.exercise.save(update_fields=['audience'])
        drawing = sketch(self.author)
        response = self.post(self.author, {'blocks': [{'kind': 'sketch', 'sketch_id': drawing.pk, 'caption': 'x'}]})
        self.assertEqual(response.status_code, 201)
        self.assertIsNotNone(Comment.objects.get(pk=response.data['id']).auto_hidden_at)


class AnchorTests(NotebookBase):
    def test_a_comment_on_a_sentence_of_the_statement(self):
        response = self.post(
            self.other,
            {'body': 'Closed interval?', 'anchor': {'block': 'statement', 'quote': 'on [0, 1]', 'prefix': 'f ', 'suffix': '.'}},
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            response.data['anchor'],
            {'block': 'statement', 'quote': 'on [0, 1]', 'prefix': 'f ', 'suffix': '.', 'state': 'attached'},
        )

    def test_a_reply_on_one_block_of_its_parent(self):
        parent = self.post(self.author, {'blocks': self.notebook()}).data
        response = self.post(
            self.other, {'body': 'Why zero?', 'parent': parent['id'], 'anchor': {'block': 'steptwo2'}}
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['anchor']['state'], 'attached')

    def test_refusal_words(self):
        parent = self.post(self.author, {'blocks': self.notebook()}).data
        plain_parent = self.post(self.author, {'body': 'Plain.'}).data
        cases = [
            ({'body': 'x', 'anchor': 'steptwo2'}, 'malformed'),
            ({'body': 'x', 'anchor': {'block': 'NOT VALID'}}, 'malformed'),
            # A reply's anchor is about its PARENT: the statement is not one of the parent's blocks.
            ({'body': 'x', 'parent': parent['id'], 'anchor': {'block': 'statement'}}, 'no_such_block'),
            ({'body': 'x', 'anchor': {'block': 'steptwo2'}}, 'no_such_block'),
            ({'body': 'x', 'anchor': {'block': 'body', 'quote': 'q' * 501}, 'parent': plain_parent['id']}, 'quote_too_long'),
        ]
        for data, word in cases:
            with self.subTest(word=word, data=str(data)[:50]):
                response = self.post(self.other, data)
                self.assertEqual(response.status_code, 400)
                self.assertEqual([str(m) for m in response.data['anchor']], [word])
        self.assertEqual(Comment.objects.exclude(pk__in=[parent['id'], plain_parent['id']]).count(), 0)

    def test_a_plain_comment_is_addressable_as_body(self):
        parent = self.post(self.author, {'body': 'One long paragraph.'}).data
        response = self.post(
            self.other, {'body': 'This part.', 'parent': parent['id'], 'anchor': {'block': 'body', 'quote': 'long'}}
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_a_target_without_blocks_refuses_an_anchor(self):
        from testing.factories import make_material

        material = make_material(self.branch)
        self.client.force_authenticate(self.other)
        response = self.client.post(
            f'/api/materials/{material.pk}/comments/', {'body': 'x', 'anchor': {'block': 'body'}}, format='json'
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual([str(m) for m in response.data['anchor']], ['not_addressable'])

    def test_an_anchor_detaches_when_its_block_is_deleted(self):
        parent = self.post(self.author, {'blocks': self.notebook()}).data
        reply = self.post(self.other, {'body': 'Why zero?', 'parent': parent['id'], 'anchor': {'block': 'steptwo2'}}).data
        edited = [b for b in self.notebook() if b['id'] != 'steptwo2']
        self.client.force_authenticate(self.author)
        self.client.patch(f'/api/comments/{parent["id"]}/', {'blocks': edited}, format='json')
        row = next(c for c in self.client.get(self.url).data if c['id'] == reply['id'])
        self.assertEqual(row['anchor']['state'], 'detached')

    def test_a_removed_parent_does_not_survive_in_its_replies_quotes(self):
        parent = self.post(self.author, {'body': 'Something regrettable.'}).data
        reply = self.post(
            self.other,
            {'body': 'Really?', 'parent': parent['id'], 'anchor': {'block': 'body', 'quote': 'regrettable'}},
        ).data
        self.client.force_authenticate(self.author)
        self.client.delete(f'/api/comments/{parent["id"]}/')
        row = next(c for c in self.client.get(self.url).data if c['id'] == reply['id'])
        self.assertEqual(row['anchor']['quote'], '')

    def test_an_anchor_is_never_edited(self):
        created = self.post(self.other, {'body': 'x', 'anchor': {'block': 'statement'}}).data
        self.client.patch(f'/api/comments/{created["id"]}/', {'body': 'y', 'anchor': {'block': 'answer'}}, format='json')
        self.assertEqual(Comment.objects.get(pk=created['id']).anchor, {'block': 'statement'})

    def test_markup_in_a_quote_is_stripped(self):
        response = self.post(
            self.other, {'body': 'x', 'anchor': {'block': 'statement', 'quote': 'max<img src=x onerror=alert(1)>imum'}}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['anchor']['quote'], 'maximum')

    def test_a_thread_of_anchored_comments_reads_the_target_once(self):
        for i in range(6):
            self.post(self.other, {'body': f'c{i}', 'anchor': {'block': 'statement'}})
        self.client.force_authenticate(None)
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as few:
            self.client.get(self.url)
        for i in range(6, 18):
            self.post(self.other, {'body': f'c{i}', 'anchor': {'block': 'statement'}})
        self.client.force_authenticate(None)
        with CaptureQueriesContext(connection) as many:
            self.client.get(self.url)
        # Votes and attachments are per-row already (`CommentSerializer`); the anchors must add none.
        per_row_before = len(few.captured_queries) / 6
        self.assertLessEqual(len(many.captured_queries), per_row_before * 18 + 1)
        anchor_queries = [q for q in many.captured_queries if 'exercises_exercisetranslation' in q['sql']]
        self.assertLessEqual(len(anchor_queries), 2)


class SolutionAndPostNotebookTests(NotebookBase):
    def test_a_notebook_solution_and_a_comment_on_one_of_its_steps(self):
        vc = make_user('nb-vc', is_verified_contributor=True)
        self.client.force_authenticate(vc)
        response = self.client.post(
            f'/api/exercises/{self.exercise.pk}/entries/',
            {'kind': 'solution', 'locale': 'pl', 'blocks': self.notebook()},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        entry = SolutionEntry.objects.get(exercise=self.exercise)
        self.assertEqual([b['id'] for b in entry.blocks], ['stepone1', 'steptwo2', 'stepthr3'])
        self.assertIn('First differentiate.', entry.body)

        self.client.force_authenticate(self.other)
        comment = self.client.post(
            f'/api/solution-entries/{entry.pk}/comments/',
            {'body': 'Is this the only critical point?', 'anchor': {'block': 'steptwo2', 'quote': "f'(x)"}},
            format='json',
        )
        self.assertEqual(comment.status_code, 201, comment.data)
        self.assertEqual(comment.data['anchor']['state'], 'attached')
        self.assertEqual(
            Comment.objects.get(pk=comment.data['id']).content_type,
            ContentType.objects.get_for_model(SolutionEntry),
        )

    def test_a_solution_needs_a_body_or_blocks(self):
        self.client.force_authenticate(self.author)
        response = self.client.post(
            f'/api/exercises/{self.exercise.pk}/entries/', {'kind': 'hint', 'locale': 'pl', 'body': ''}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_a_notebook_post_in_json_and_in_multipart(self):
        self.client.force_authenticate(self.author)
        response = self.client.post(
            '/api/posts/', {'branch': self.branch.slug, 'blocks': self.notebook()}, format='json'
        )
        self.assertEqual(response.status_code, 201, response.data)
        import json

        response = self.client.post(
            '/api/posts/', {'branch': self.branch.slug, 'blocks': json.dumps(self.notebook())}, format='multipart'
        )
        self.assertEqual(response.status_code, 201, response.data)
        detail = self.client.get(f'/api/posts/{response.data["id"]}/').data
        self.assertEqual([b['kind'] for b in detail['blocks']], ['markdown', 'latex', 'code'])

    def test_the_exercise_is_still_readable_by_its_plain_api(self):
        # The derived body keeps every reader that only knows `body` working.
        self.post(self.author, {'blocks': self.notebook()})
        rows = self.client.get(self.url).data
        self.assertTrue(rows[0]['body'])
        self.assertTrue(Exercise.objects.filter(pk=self.exercise.pk).exists())
