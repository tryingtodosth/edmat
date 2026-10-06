"""Part of this project's first real automated test suite (CLAUDE.md Section 17I/17K's own "no
formal automated test suite exists" note). Covers the core browsing/filtering contract (Section 7's
own functional requirement 1), the "resolve, fall back to original" locale behavior every
translatable model in this app shares (Section 10), the translation submission flow, and a
regression test for the shared-serializer-instance bug the moderation-queue load test found and fixed
(CLAUDE.md Section 17F) — a real data-integrity bug, not just a performance one, so it earns a
permanent regression test here rather than staying only a documented, one-time finding.
"""

import shutil
import tempfile
from io import StringIO
from pathlib import Path
from textwrap import dedent

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import Exercise, ExerciseTranslation, Tag
from taxonomy.models import Topic
from telemetry.routers import all_log_shards
from testing.factories import make_course, make_exercise, make_topic, make_user


class ExerciseListingTests(APITestCase):
    # The request-logging middleware writes to its own shards; a view test that does not declare
    # them fails on Django's cross-database guard rather than on anything under test, and this
    # file has no shared base, so every class that makes a request repeats the line.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_course()
        self.easy = make_exercise(self.branch, 1, difficulty='easy')
        self.hard = make_exercise(self.branch, 2, difficulty='hard')

    def test_course_exercises_lists_both(self):
        response = self.client.get(reverse('branch-exercises', kwargs={'slug': self.branch.slug}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row['id'] for row in response.data}
        self.assertEqual(ids, {self.easy.pk, self.hard.pk})

    def test_course_exercises_filters_by_difficulty(self):
        response = self.client.get(
            reverse('branch-exercises', kwargs={'slug': self.branch.slug}), {'difficulty': 'hard'}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row['id'] for row in response.data}
        self.assertEqual(ids, {self.hard.pk})


class ExerciseSubmittedByFilterTests(APITestCase):
    """The public profile page's own new "what they were doing/contributing" section (CLAUDE.md's
    tutoring-listings feature note, item 6) needs a way to list a specific user's own published
    exercise submissions — `?submitted_by=<id>` on the plain exercise list endpoint."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_course()
        self.author = make_user('u-contributor')
        self.mine = make_exercise(self.branch, 1, title='Mine')
        self.mine.submitted_by = self.author
        self.mine.save(update_fields=['submitted_by'])
        self.someone_elses = make_exercise(self.branch, 2, title='Not mine')

    def test_filters_to_only_that_users_submissions(self):
        response = self.client.get(reverse('exercise-list'), {'submitted_by': self.author.pk})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row['id'] for row in response.data}
        self.assertEqual(ids, {self.mine.pk})

    def test_a_pending_unpublished_submission_never_leaks_through(self):
        self.mine.published = False
        self.mine.save(update_fields=['published'])
        response = self.client.get(reverse('exercise-list'), {'submitted_by': self.author.pk})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])


class ExerciseLocaleResolutionTests(APITestCase):
    """CLAUDE.md Section 10's "resolve, fall back to original" behavior — a reader always sees the
    published translation for their requested `?lang=`, falling back to the original locale when
    none exists yet for the one they asked for."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1, locale='pl', title='Polska wersja')

    def test_lang_param_resolves_to_a_real_translation_when_one_exists(self):
        ExerciseTranslation.objects.create(
            exercise=self.exercise,
            locale='en',
            title='English version',
            statement='English statement.',
            status='published',
        )

        response = self.client.get(
            reverse('exercise-detail', kwargs={'pk': self.exercise.pk}), {'lang': 'en'}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['title'], 'English version')
        self.assertEqual(response.data['resolved_locale'], 'en')

    def test_lang_param_falls_back_to_original_locale_when_untranslated(self):
        response = self.client.get(
            reverse('exercise-detail', kwargs={'pk': self.exercise.pk}), {'lang': 'de'}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['title'], 'Polska wersja')
        self.assertEqual(response.data['resolved_locale'], 'pl')


class ExerciseTranslationSubmissionTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)

    def test_authenticated_user_can_submit_a_translation(self):
        self.client.force_authenticate(make_user('translator'))

        response = self.client.post(
            reverse('exercise-translations', kwargs={'pk': self.exercise.pk}),
            {'locale': 'en', 'title': 'A translation', 'statement': 'Translated statement.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        translation = self.exercise.translations.get(locale='en')
        self.assertEqual(translation.status, 'pending')

    def test_anonymous_user_cannot_submit_a_translation(self):
        response = self.client.post(
            reverse('exercise-translations', kwargs={'pk': self.exercise.pk}),
            {'locale': 'en', 'title': 'A translation', 'statement': 'Translated statement.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(self.exercise.translations.filter(locale='en').exists())


class ExerciseBulkEndpointTests(APITestCase):
    """Regression test for the real, found-before-first-use data-integrity bug CLAUDE.md Section
    17F documents: ExerciseDetailSerializer used to cache its resolved translation on `self`, which
    DRF's `ListSerializer` shares as ONE instance across every row under `many=True` — every exercise
    past the first in a bulk response showed the FIRST one's own title/statement instead of its own.
    Fixed by caching on the per-row object instead; this test locks that fix in place."""

    databases = set(all_log_shards()) | {'default'}

    def test_each_exercise_in_a_bulk_response_keeps_its_own_distinct_content(self):
        branch = make_course()
        exercises = [
            make_exercise(branch, n, title=f'Title {n}', statement=f'Statement {n}.')
            for n in range(1, 6)
        ]

        response = self.client.get(
            reverse('exercise-bulk'), {'ids': ','.join(str(e.pk) for e in exercises)}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 5)
        titles = [row['title'] for row in response.data]
        statements = [row['statement'] for row in response.data]
        self.assertEqual(len(titles), len(set(titles)), 'every exercise must keep its own distinct title')
        self.assertEqual(
            len(statements), len(set(statements)), 'every exercise must keep its own distinct statement'
        )


class ContentSanitizationTests(APITestCase):
    """A real security-scan finding, closed: ExerciseTranslation.statement/hint/answer/solution
    (rendered client-side as `{@html}` via MathContent.svelte) had ZERO server-side sanitization —
    the frontend's own DOMPurify pass was the ONLY defense, including for content that publishes
    with no moderator review at all (a verified contributor's new exercise). Fixed via
    ExerciseTranslation.save() calling config.sanitize.sanitize_content unconditionally; these tests
    exercise that fix through the real model save path, not the sanitizer function in isolation."""

    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)

    def _translate(self, **fields):
        defaults = {'locale': 'en', 'status': 'published', 'title': 't', 'statement': 's'}
        defaults.update(fields)
        return ExerciseTranslation.objects.create(exercise=self.exercise, **defaults)

    def test_a_script_tag_is_stripped_on_save(self):
        t = self._translate(statement='<script>alert(1)</script><p>Real content.</p>')
        self.assertNotIn('<script', t.statement)
        self.assertIn('<p>Real content.</p>', t.statement)

    def test_an_event_handler_attribute_is_stripped_on_save(self):
        t = self._translate(statement='<img src="x" onerror="alert(1)">')
        self.assertNotIn('onerror', t.statement)

    def test_a_javascript_href_is_stripped_on_save(self):
        t = self._translate(statement='<a href="javascript:alert(1)">click</a>')
        self.assertNotIn('javascript:', t.statement)

    def test_legitimate_math_delimiters_survive_unchanged(self):
        """The real, found-before-shipping bug this fix's own build caught: bleach's HTML5 parser
        normalizes a bare `<`/`>` into an entity, which would corrupt a real inequality like
        `\\(p<\\infty\\)` into `\\(p&lt;\\infty\\)` — silently breaking KaTeX rendering for a huge
        share of this math-heavy corpus's real content. Locks in the fix (stash math segments
        before bleach ever sees them, splice the original back in unchanged after)."""
        statement = r'<p>For \(p<\infty\) and \(x>0\), consider \[f(x)=x^p.\]</p>'
        t = self._translate(statement=statement)
        self.assertEqual(t.statement, statement)

    def test_a_real_svg_diagram_survives_unchanged(self):
        statement = (
            '<svg viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="A circle">'
            '<circle cx="50" cy="50" r="40" fill="red" stroke="black" stroke-width="2"></circle>'
            '</svg>'
        )
        t = self._translate(statement=statement)
        self.assertEqual(t.statement, statement)

    def test_the_title_field_is_sanitized_too(self):
        t = self._translate(title='<img src=x onerror=alert(1)>Evil title')
        self.assertNotIn('onerror', t.title)
        self.assertIn('Evil title', t.title)


class ImportExercisesCommandTests(TestCase):
    """`manage.py import_exercises` — the batch-import path documented in
    `.claude/skills/import-exercises/SKILL.md`. Every assertion here is a property the skill
    promises an LLM it can rely on: idempotency by `(branch, number)`, derived `verified`, community
    tags surviving a re-run, and a batch with one bad file importing nothing at all.
    """

    def setUp(self):
        self.branch = make_course(slug='import-target')
        make_topic(self.branch, 'calki')
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, name, body):
        path = self.dir / name
        path.write_text(dedent(body).lstrip(), encoding='utf-8')
        return path

    def run_import(self, **kwargs):
        out = StringIO()
        call_command('import_exercises', str(self.dir), branch=self.branch.slug, stdout=out, stderr=out, **kwargs)
        return out.getvalue()

    GOOD = """
        ---
        number: 7
        title: Całka testowa
        topics: [calki]
        difficulty: trudne
        source: {type: Egzamin, name: Egzamin 2025, pages: 3}
        tags: [calka-gaussa]
        ---
        ## Treść
        Oblicz \\(\\int_0^1 x^2\\,dx\\).
        ## Wskazówka
        Wzór na całkę z potęgi.
        ## Odpowiedź
        \\(\\tfrac13\\)
        ## Rozwiązanie
        \\[\\int_0^1 x^2\\,dx = \\tfrac13.\\]
        """

    def test_a_file_becomes_an_exercise_its_translation_and_its_pinned_entries(self):
        self.write('0007.md', self.GOOD)
        self.run_import()

        exercise = Exercise.objects.get(branch=self.branch, number=7)
        self.assertEqual(exercise.difficulty, 'hard')
        self.assertEqual(exercise.audience, 'university')
        self.assertIsNone(exercise.submitted_by)
        self.assertEqual([t.slug for t in exercise.topics.all()], ['calki'])
        self.assertEqual([t.slug for t in exercise.tags.all()], ['calka-gaussa'])

        translation = exercise.translations.get(locale='pl', status='published')
        self.assertEqual(translation.title, 'Całka testowa')
        self.assertIn(r'\(\int_0^1 x^2\,dx\)', translation.statement)
        self.assertIsNone(translation.translated_by)

        self.assertEqual(
            sorted(exercise.entries.values_list('kind', flat=True)), ['hint', 'solution']
        )
        self.assertTrue(all(e.pinned and e.status == 'published' for e in exercise.entries.all()))
        self.assertEqual(exercise.source.type, 'exam')
        self.assertEqual(exercise.source.translations.get(locale='pl').name, 'Egzamin 2025')

    def test_verified_is_derived_from_the_pinned_solution_not_from_the_file(self):
        self.write('0007.md', self.GOOD)
        self.write(
            '0008.md',
            """
            ---
            number: 8
            title: Bez rozwiązania
            difficulty: easy
            ---
            ## Treść
            Policz \\(2+2\\).
            """,
        )
        self.run_import()
        self.assertTrue(Exercise.objects.get(branch=self.branch, number=7).verified)
        self.assertFalse(Exercise.objects.get(branch=self.branch, number=8).verified)

    def test_a_second_run_updates_in_place_and_keeps_a_readers_tag(self):
        path = self.write('0007.md', self.GOOD)
        self.run_import()
        exercise = Exercise.objects.get(branch=self.branch, number=7)
        exercise.tags.add(Tag.objects.create(slug='applied-by-a-reader'))

        path.write_text(path.read_text(encoding='utf-8').replace('Całka testowa', 'Całka Gaussa'), encoding='utf-8')
        self.run_import()

        self.assertEqual(Exercise.objects.filter(branch=self.branch).count(), 1)
        self.assertEqual(ExerciseTranslation.objects.filter(exercise=exercise, status='published').count(), 1)
        self.assertEqual(exercise.translations.get(status='published').title, 'Całka Gaussa')
        self.assertIn('applied-by-a-reader', [t.slug for t in exercise.tags.all()])

    def test_a_file_without_a_number_gets_one_and_has_it_written_back(self):
        make_exercise(self.branch, 41)
        path = self.write(
            'new.md',
            """
            ---
            title: Nowe zadanie
            difficulty: medium
            ---
            ## Statement
            Compute \\(1+1\\).
            """,
        )
        self.run_import()
        self.assertTrue(Exercise.objects.filter(branch=self.branch, number=42).exists())
        self.assertIn('number: 42', path.read_text(encoding='utf-8'))

        # And the written-back number is exactly what makes the re-run an update, not a second row.
        self.run_import()
        self.assertEqual(Exercise.objects.filter(branch=self.branch).count(), 2)

    def test_one_bad_file_aborts_the_whole_batch(self):
        self.write('0007.md', self.GOOD)
        self.write(
            'bad.md',
            """
            ---
            number: 9
            title: Zepsute
            difficulty: hardcore
            verified: true
            ---
            ## Treść
            Niedomknięta \\(x^2.
            ## Wskazóweczka
            Ten tekst by zniknął.
            """,
        )
        with self.assertRaises(CommandError):
            self.run_import()
        self.assertEqual(Exercise.objects.filter(branch=self.branch).count(), 0)

    def test_an_unknown_topic_is_refused_unless_topics_may_be_created(self):
        self.write(
            '0007.md',
            """
            ---
            number: 7
            title: Nowy temat
            topics: [teoria-miary]
            difficulty: easy
            ---
            ## Treść
            Policz \\(2+2\\).
            """,
        )
        with self.assertRaises(CommandError):
            self.run_import()
        self.run_import(create_topics=True)
        exercise = Exercise.objects.get(branch=self.branch, number=7)
        self.assertEqual([t.slug for t in exercise.topics.all()], ['teoria-miary'])
        self.assertEqual(Topic.objects.get(branch=self.branch, slug='teoria-miary').status, 'approved')

    def test_a_dry_run_writes_nothing(self):
        self.write('0007.md', self.GOOD)
        self.run_import(dry_run=True)
        self.assertEqual(Exercise.objects.filter(branch=self.branch).count(), 0)

    def test_a_re_import_does_not_republish_a_row_somebody_hid(self):
        """The one direction an import must not move: `published` back up. A moderator's removal or
        a report-driven auto-hide is a decision, and re-running the batch it came from is not an
        appeal against it."""
        self.write('0007.md', self.GOOD)
        self.run_import()
        Exercise.objects.filter(branch=self.branch, number=7).update(published=False)

        output = self.run_import()

        self.assertFalse(Exercise.objects.get(branch=self.branch, number=7).published)
        self.assertIn('left hidden', output)
