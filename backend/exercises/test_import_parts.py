"""`manage.py import_exercises` with part sections — `## Podpunkt a` / `## Part a`
(`SUBEXERCISES-BRIEF.md` §4, `prompts/21-parts-b-import.md`, HISTORY §17CV.B).

The parser (labels, order, every refusal with its reason) and the apply (create, a re-run that
changes nothing and says so, an edit that updates in place, a part removed with its entries, the
whole exercise's own solution untouched beside its parts', `--dry-run`, the pinned key carrying
`part`, a file without parts leaving parts alone, the licence moving part entries). No test here
reaches an endpoint, so these are plain `TestCase`s and declare no log shards
(`backend/CLAUDE.md` "Testing": the checker keeps its bite only if nobody declares them for nothing).
"""

from __future__ import annotations

import re
import shutil
import tempfile
from io import StringIO
from pathlib import Path
from textwrap import dedent

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from exercises.management.commands.import_exercises import split_file
from exercises.models import Exercise, ExercisePart, ExercisePartTranslation, SolutionEntry
from testing.factories import make_branch, make_topic, make_user

#: The worked example in the format reference is a test fixture: "the example file imports" is a
#: promise the skill makes, and a doc example nobody runs is a doc example that rots.
FORMAT_MD = Path(__file__).resolve().parents[2] / '.claude/skills/import-exercises/reference/format.md'

HEAD = """
    ---
    number: 5
    title: Postać algebraiczna
    topics: [dzialania]
    difficulty: latwe
    ---
    ## Treść
    Przedstawić w postaci \\(a+bi\\):
    """


def part(label, statement, *, hint='', answer='', solution='', keyword='Podpunkt'):
    text = f'\n    ## {keyword} {label}\n    ## Treść\n    {statement}\n'
    if hint:
        text += f'    ## Wskazówka\n    {hint}\n'
    if answer:
        text += f'    ## Odpowiedź\n    {answer}\n'
    if solution:
        text += f'    ## Rozwiązanie\n    {solution}\n'
    return text


THREE_PARTS = (
    HEAD
    + part('1', '\\((1-i)^2\\)', answer='\\(-2i\\)', solution='Wymnóż: \\(1-2i+i^2\\).')
    + part('2', '\\(w^3\\)', hint='Najpierw kwadrat.', answer='\\(1\\)', solution='\\(w^2=\\bar w\\).')
    + part('3', '\\(\\frac{2-i}{3+4i}\\)', hint='Sprzężenie.', solution='Pomnóż przez \\(3-4i\\).')
)


class ImportPartsBase(TestCase):
    def setUp(self):
        self.branch = make_branch('parts-import')
        make_topic(self.branch, 'dzialania')
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, body, name='0005.md'):
        path = self.dir / name
        path.write_text(dedent(body).lstrip(), encoding='utf-8')
        return path

    def run_import(self, **kwargs):
        out = StringIO()
        try:
            call_command(
                'import_exercises', str(self.dir), branch=self.branch.slug, stdout=out, stderr=out, **kwargs
            )
        finally:
            self.last_output = out.getvalue()
        return out.getvalue()

    def refused(self, body):
        """Imports `body` expecting a refusal; returns the report, and asserts nothing was written."""
        self.write(body)
        with self.assertRaises(CommandError):
            self.run_import()
        self.assertFalse(Exercise.objects.filter(branch=self.branch).exists())
        return self.last_output

    def exercise(self):
        return Exercise.objects.get(branch=self.branch, number=5)


class PartParserTests(ImportPartsBase):
    def test_split_file_reads_the_whole_sections_then_the_parts_in_order(self):
        path = self.write(
            HEAD
            + '\n    ## Wskazówka\n    Dla wszystkich.\n'
            + part('a', 'Pierwszy.', answer='A1')
            + part('b', 'Drugi.', hint='H2', solution='S2', keyword='Part')
            + part('ii', 'Trzeci.', keyword='podpunkt')
        )
        meta, whole, parts, errors = split_file(path)
        self.assertEqual(errors, [])
        self.assertEqual(meta['number'], 5)
        self.assertEqual(whole, {'statement': 'Przedstawić w postaci \\(a+bi\\):', 'hint': 'Dla wszystkich.'})
        self.assertEqual([label for label, _ in parts], ['a', 'b', 'ii'])
        self.assertEqual(parts[0][1], {'statement': 'Pierwszy.', 'answer': 'A1'})
        self.assertEqual(parts[1][1], {'statement': 'Drugi.', 'hint': 'H2', 'solution': 'S2'})

    def test_the_label_is_the_trimmed_free_text_after_the_keyword_with_its_case_kept(self):
        path = self.write(HEAD + part('  (B)  ', 'x') + part('Zadanie 4j', 'y'))
        _, _, parts, errors = split_file(path)
        self.assertEqual(errors, [])
        self.assertEqual([label for label, _ in parts], ['(B)', 'Zadanie 4j'])

    def test_a_part_without_a_label_is_refused(self):
        report = self.refused(HEAD + '\n    ## Podpunkt\n    ## Treść\n    x\n')
        self.assertIn('has no label', report)

    def test_a_label_over_twenty_characters_is_refused(self):
        report = self.refused(HEAD + part('a' * 21, 'x'))
        self.assertIn('is 21 characters', report)

    def test_two_parts_with_the_same_label_are_refused(self):
        report = self.refused(HEAD + part('a', 'x') + part('a', 'y'))
        self.assertIn('two parts are labelled "a"', report)

    def test_a_part_with_no_statement_is_refused(self):
        report = self.refused(HEAD + '\n    ## Podpunkt a\n    ## Odpowiedź\n    42\n')
        self.assertIn('part "a" has no `## Treść`', report)

    def test_a_part_with_an_empty_statement_is_refused(self):
        report = self.refused(HEAD + '\n    ## Podpunkt a\n    ## Treść\n\n    ## Odpowiedź\n    42\n')
        self.assertIn('part "a" has no `## Treść`', report)

    def test_a_whole_exercise_section_after_the_parts_is_refused(self):
        # The shared answer written at the end, after the parts, can only be read as part b's
        # second answer — "whole first, then parts" — so it is refused rather than glued on.
        report = self.refused(
            HEAD + part('a', 'x') + part('b', 'y', answer='B') + '\n    ## Odpowiedź\n    wspólna\n'
        )
        self.assertIn('appears twice in part "b"', report)
        self.assertIn('whole-exercise sections go before the first part', report)

    def test_a_section_named_twice_before_the_parts_is_refused_too(self):
        report = self.refused(HEAD + '\n    ## Wskazówka\n    h1\n    ## Wskazówka\n    h2\n')
        self.assertIn('appears twice in the whole exercise', report)

    def test_text_straight_under_a_part_heading_is_refused_not_dropped(self):
        report = self.refused(HEAD + '\n    ## Podpunkt a\n    To miała być treść.\n    ## Treść\n    x\n')
        self.assertIn('outside any section and would be dropped', report)

    def test_the_shared_statement_is_still_required(self):
        report = self.refused(
            """
            ---
            number: 5
            title: Bez wspólnej treści
            difficulty: latwe
            ---
            ## Podpunkt a
            ## Treść
            x
            """
        )
        self.assertIn('`## Treść` (statement) is empty', report)

    def test_unbalanced_maths_in_a_part_is_refused_and_named(self):
        report = self.refused(HEAD + part('a', 'x', solution='\\(1+1 = 2'))
        self.assertIn('part "a" solution: 1× "\\(" but 0× "\\)"', report)

    def test_an_unknown_heading_still_names_the_part_keywords(self):
        report = self.refused(HEAD + '\n    ## Zadanie b\n    x\n')
        self.assertIn('unknown section heading "## Zadanie b"', report)
        self.assertIn('"Podpunkt <label>" / "Part <label>"', report)


class PartApplyTests(ImportPartsBase):
    def test_a_file_with_parts_creates_them_in_order_with_their_text_and_pinned_entries(self):
        author = make_user('todoonet')
        self.write(THREE_PARTS)
        output = self.run_import(author='todoonet')

        exercise = self.exercise()
        parts = list(exercise.parts.order_by('order'))
        self.assertEqual([(p.order, p.label) for p in parts], [(1, '1'), (2, '2'), (3, '3')])
        first = parts[0].translations.get()
        self.assertEqual((first.locale, first.status, first.translated_by), ('pl', 'published', None))
        self.assertEqual(first.statement, '\\((1-i)^2\\)')
        self.assertEqual(first.answer, '\\(-2i\\)')
        self.assertEqual(parts[2].translations.get().answer, '')

        entries = SolutionEntry.objects.filter(exercise=exercise)
        self.assertEqual(
            sorted((e.part.label, e.kind) for e in entries),
            [('1', 'solution'), ('2', 'hint'), ('2', 'solution'), ('3', 'hint'), ('3', 'solution')],
        )
        self.assertTrue(all(e.pinned and e.status == 'published' and e.author == author for e in entries))
        self.assertTrue(all(e.licence == exercise.licence for e in entries))
        # The shared statement is the exercise's own; the parts carry the answers.
        self.assertEqual(exercise.translations.get().statement, 'Przedstawić w postaci \\(a+bi\\):')
        self.assertTrue(exercise.verified)
        self.assertIn('parts: 3 created, 0 updated, 0 removed.', output)
        self.assertIn('5 hint/solution row(s)', output)

    def test_a_second_run_of_the_same_file_changes_nothing_and_says_so(self):
        self.write(THREE_PARTS)
        self.run_import()
        before = {
            'parts': list(ExercisePart.objects.values_list('pk', 'order', 'label')),
            'texts': list(ExercisePartTranslation.objects.values_list('pk', 'statement', 'answer')),
            'entries': list(SolutionEntry.objects.values_list('pk', 'body', 'updated_at')),
        }
        output = self.run_import()
        self.assertIn('parts: 0 created, 0 updated, 0 removed.', output)
        self.assertEqual(before['parts'], list(ExercisePart.objects.values_list('pk', 'order', 'label')))
        self.assertEqual(
            before['texts'], list(ExercisePartTranslation.objects.values_list('pk', 'statement', 'answer'))
        )
        # Not even re-saved: an unchanged entry keeps its updated_at.
        self.assertEqual(before['entries'], list(SolutionEntry.objects.values_list('pk', 'body', 'updated_at')))

    def test_an_edited_part_is_updated_in_place_not_duplicated(self):
        path = self.write(THREE_PARTS)
        self.run_import()
        part2 = ExercisePart.objects.get(order=2)
        hint_pk = SolutionEntry.objects.get(part=part2, kind='hint').pk

        path.write_text(
            path.read_text(encoding='utf-8')
            .replace('## Podpunkt 2', '## Podpunkt b')
            .replace('Najpierw kwadrat.', 'Najpierw policz kwadrat.'),
            encoding='utf-8',
        )
        output = self.run_import()
        self.assertIn('parts: 0 created, 1 updated, 0 removed.', output)
        part2.refresh_from_db()
        self.assertEqual(part2.label, 'b')
        self.assertEqual(ExercisePart.objects.count(), 3)
        hint = SolutionEntry.objects.get(part=part2, kind='hint')
        self.assertEqual((hint.pk, hint.body), (hint_pk, 'Najpierw policz kwadrat.'))

    def test_a_part_beyond_the_files_count_is_removed_with_its_entries(self):
        path = self.write(THREE_PARTS)
        self.run_import()
        third = ExercisePart.objects.get(order=3)
        self.assertEqual(third.entries.count(), 2)

        text = path.read_text(encoding='utf-8')
        path.write_text(text[: text.index('## Podpunkt 3')], encoding='utf-8')
        output = self.run_import()

        self.assertIn('parts: 0 created, 0 updated, 1 removed.', output)
        self.assertIn("had 1 part(s) beyond the file's 2 (3) — removed, with 2 hint/solution row(s)", output)
        self.assertEqual(list(self.exercise().parts.values_list('label', flat=True)), ['1', '2'])
        self.assertEqual(SolutionEntry.objects.filter(exercise=self.exercise()).count(), 3)
        self.assertFalse(ExercisePartTranslation.objects.filter(part_id=third.pk).exists())

    def test_the_whole_exercises_solution_stands_beside_the_parts_solutions(self):
        # The pinned key is (exercise, part, kind, locale, pinned=True): without `part`, the whole
        # exercise's solution would overwrite a part's — or, with three parts solved, raise
        # MultipleObjectsReturned on the second run.
        whole = HEAD + '\n    ## Rozwiązanie\n    Rozwiązanie całości.\n'
        path = self.write(whole + THREE_PARTS[len(HEAD):])
        self.run_import()
        self.run_import()

        exercise = self.exercise()
        whole_solution = SolutionEntry.objects.get(exercise=exercise, part=None, kind='solution')
        self.assertEqual(whole_solution.body, 'Rozwiązanie całości.')
        self.assertEqual(SolutionEntry.objects.filter(exercise=exercise, kind='solution').count(), 4)
        self.assertEqual(
            SolutionEntry.objects.get(part__order=1, kind='solution').body, 'Wymnóż: \\(1-2i+i^2\\).'
        )

        # Editing the whole solution leaves every part's untouched, and the other way round.
        path.write_text(
            path.read_text(encoding='utf-8')
            .replace('Rozwiązanie całości.', 'Nowe rozwiązanie całości.')
            .replace('Wymnóż:', 'Rozpisz:'),
            encoding='utf-8',
        )
        output = self.run_import()
        self.assertIn('parts: 0 created, 1 updated, 0 removed.', output)
        whole_solution.refresh_from_db()
        self.assertEqual(whole_solution.body, 'Nowe rozwiązanie całości.')
        self.assertEqual(
            SolutionEntry.objects.get(part__order=1, kind='solution').body, 'Rozpisz: \\(1-2i+i^2\\).'
        )
        self.assertEqual(SolutionEntry.objects.get(part__order=2, kind='solution').body, '\\(w^2=\\bar w\\).')

    def test_dry_run_writes_nothing_and_reports_the_counts(self):
        self.write(THREE_PARTS)
        output = self.run_import(dry_run=True)
        self.assertIn('parts: 3 created, 0 updated, 0 removed.', output)
        self.assertIn('--dry-run: rolling the transaction back.', output)
        self.assertFalse(Exercise.objects.exists())
        self.assertFalse(ExercisePart.objects.exists())
        self.assertFalse(SolutionEntry.objects.exists())

    def test_dry_run_of_a_shrunk_set_removes_nothing(self):
        path = self.write(THREE_PARTS)
        self.run_import()
        text = path.read_text(encoding='utf-8')
        path.write_text(text[: text.index('## Podpunkt 2')], encoding='utf-8')
        output = self.run_import(dry_run=True)
        self.assertIn('parts: 0 created, 0 updated, 2 removed.', output)
        self.assertEqual(ExercisePart.objects.count(), 3)
        self.assertEqual(SolutionEntry.objects.count(), 5)

    def test_a_file_without_parts_leaves_existing_parts_alone(self):
        path = self.write(THREE_PARTS)
        self.run_import()
        path.write_text(dedent(HEAD).lstrip(), encoding='utf-8')
        output = self.run_import()
        self.assertIn('parts: 0 created, 0 updated, 0 removed.', output)
        self.assertEqual(ExercisePart.objects.count(), 3)
        self.assertEqual(SolutionEntry.objects.count(), 5)

    def test_splitting_a_one_solution_file_into_parts_removes_the_old_whole_entries(self):
        # The 964 path: paczka3 imported one hint and one solution for all four items; paczka4 is
        # the same exercise with parts. The old whole entries must not stand beside the new ones.
        make_user('todoonet')
        path = self.write(
            HEAD
            + '\n    ## Wskazówka\n    Stara wskazówka do wszystkiego.\n'
            + '    ## Odpowiedź\n    \\(-2i,\\ 1\\)\n'
            + '    ## Rozwiązanie\n    <p><b>1.</b> stare</p><p><b>2.</b> stare</p>\n'
        )
        self.run_import(author='todoonet')
        self.assertEqual(SolutionEntry.objects.filter(part=None).count(), 2)

        path.write_text(dedent(THREE_PARTS).lstrip(), encoding='utf-8')
        output = self.run_import(author='todoonet')

        exercise = self.exercise()
        self.assertFalse(SolutionEntry.objects.filter(exercise=exercise, part=None).exists())
        self.assertEqual(exercise.translations.get().answer, '')
        self.assertIn('removed the pinned hint for the whole exercise', output)
        self.assertIn('2 pinned hint/solution row(s) an earlier import wrote were removed', output)
        self.assertTrue(exercise.verified)

    def test_an_old_whole_entry_with_a_thread_or_a_vote_is_left_not_deleted(self):
        # House rule 12: a thread must not break. A reader commented on the old solution and voted
        # on the old hint; converting the file to parts leaves both, says so, and still writes the parts.
        from django.contrib.contenttypes.models import ContentType

        from community.models import Comment
        from exercises.models import SolutionEntryVote

        path = self.write(
            HEAD + '\n    ## Wskazówka\n    Stara.\n    ## Rozwiązanie\n    Stare rozwiązanie.\n'
        )
        self.run_import()
        reader = make_user('reader')
        old_solution = SolutionEntry.objects.get(part=None, kind='solution')
        old_hint = SolutionEntry.objects.get(part=None, kind='hint')
        Comment.objects.create(
            content_type=ContentType.objects.get_for_model(SolutionEntry), object_id=old_solution.pk,
            author=reader, body='Dzięki!',
        )
        SolutionEntryVote.objects.create(entry=old_hint, voter=reader, value=1)

        path.write_text(dedent(THREE_PARTS).lstrip(), encoding='utf-8')
        output = self.run_import()
        self.assertTrue(SolutionEntry.objects.filter(pk__in=[old_solution.pk, old_hint.pk]).count() == 2)
        self.assertIn('has 1 comment(s) and 0 vote(s)', output)
        self.assertIn('has 0 comment(s) and 1 vote(s)', output)
        self.assertIn('parts: 3 created, 0 updated, 0 removed.', output)

    def test_a_pinned_entry_somebody_else_wrote_is_left_and_named(self):
        self.write(THREE_PARTS)
        self.run_import()
        exercise = self.exercise()
        staff_pick = SolutionEntry.objects.create(
            exercise=exercise, kind='solution', locale='pl', body='Czyjeś rozwiązanie.',
            author=make_user('someone'), status='published', pinned=True,
        )
        output = self.run_import()
        self.assertTrue(SolutionEntry.objects.filter(pk=staff_pick.pk).exists())
        self.assertIn("by somebody else — the file has none, but that is not the file's to delete; left.", output)

    def test_a_dropped_part_hint_is_removed_on_the_next_run(self):
        path = self.write(THREE_PARTS)
        self.run_import()
        path.write_text(path.read_text(encoding='utf-8').replace('## Wskazówka\nNajpierw kwadrat.\n', ''), encoding='utf-8')
        output = self.run_import()
        self.assertFalse(SolutionEntry.objects.filter(part__order=2, kind='hint').exists())
        self.assertTrue(SolutionEntry.objects.filter(part__order=3, kind='hint').exists())
        self.assertIn('parts: 0 created, 1 updated, 0 removed.', output)
        self.assertIn('removed the pinned hint for part "2"', output)

    def test_a_licence_rerun_moves_the_part_entries_with_the_whole(self):
        self.write(THREE_PARTS)
        self.run_import()
        self.assertEqual(set(SolutionEntry.objects.values_list('licence', flat=True)), {'unknown'})
        output = self.run_import(licence='cc-by-sa-4.0')
        self.assertEqual(self.exercise().licence, 'cc-by-sa-4.0')
        self.assertEqual(set(SolutionEntry.objects.values_list('licence', flat=True)), {'cc-by-sa-4.0'})
        # Moved by `_relicense`'s pinned-entry update, so the parts themselves did not change.
        self.assertIn('parts: 0 created, 0 updated, 0 removed.', output)

    def test_the_worked_example_in_the_format_reference_imports(self):
        text = FORMAT_MD.read_text(encoding='utf-8')
        marker = text.index('## Parts — a set-shaped exercise')
        example = re.search(r'```markdown\n(.*?)```', text[marker:], re.S).group(1)
        make_topic(self.branch, 'liczby-zespolone-dzialania')
        (self.dir / '0005.md').write_text(example, encoding='utf-8')
        output = self.run_import()
        self.assertIn('parts: 4 created, 0 updated, 0 removed.', output)
        exercise = self.exercise()
        self.assertEqual(list(exercise.parts.values_list('label', flat=True)), ['1', '2', '3', '4'])
        self.assertEqual(
            sorted(SolutionEntry.objects.filter(exercise=exercise, kind='hint').values_list('part__label', flat=True)),
            ['2', '3', '4'],
        )
        self.assertTrue(exercise.verified)
