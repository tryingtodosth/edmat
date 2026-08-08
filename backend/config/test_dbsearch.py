"""The Polish-diacritics search bug, and the lookup that fixes it.

Run against `icontains` before the fix, three of these failed for real — the exercise statement
`ZBIEŻNOŚĆ` searched as `zbieżność`, and both material fields (`Ćwiczenia`, `ŚREDNIĄ`). That is the
whole file's justification, and it was confirmed by running it both ways rather than assumed from the
code reading correctly.

Worth keeping the fourth in mind, because it is why the bug survived this long: `Ciągi liczbowe`
searched as `ciągi` matched even before the fix, since the only letter whose case differs there is
the ASCII `C`. The failure is not "Polish breaks search", it is "Polish breaks search whenever the
letter whose case differs is not ASCII" — which looks like an intermittent fault from the outside.
See config/dbsearch.py for the reproduction at the SQL level and for what was rejected on the way
to this fix.

It lives beside the fix rather than in one app's tests because the fix is cross-app: the same broken
lookup was behind the exercise browse search, the material browse search and the new in-course
search, so a home inside any one of those three would misfile it.
"""

from django.db import connection
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APITestCase

from config.dbsearch import contains_all, fold, search_terms
from exercises.models import ExerciseTranslation
from testing.factories import make_branch, make_exercise, make_material


class FoldTests(SimpleTestCase):
    """The one folding rule, which both the database and the Python matcher call."""

    def test_folds_polish_diacritics_which_sqlites_own_lower_does_not(self):
        self.assertEqual(fold('CIĄGI'), 'ciągi')
        self.assertEqual(fold('Ćwiczenia'), 'ćwiczenia')
        self.assertEqual(fold('ŁUK'), 'łuk')

    def test_none_folds_to_empty_so_a_null_column_matches_nothing(self):
        self.assertEqual(fold(None), '')

    def test_casefold_rather_than_lower_so_sharp_s_matches_ss(self):
        # Not a Polish concern, but it is why `casefold()` was chosen over `lower()` and it should
        # break loudly if somebody swaps them back.
        self.assertEqual(fold('Straße'), 'strasse')

    def test_accents_are_deliberately_kept(self):
        # A deliberate non-goal, documented in dbsearch.py: `łuk` and `luk` are different words.
        self.assertNotEqual(fold('zbiór'), 'zbior')

    def test_terms_are_split_folded_and_capped(self):
        self.assertEqual(search_terms('  Cauchy   SZEREG '), ['cauchy', 'szereg'])
        self.assertEqual(search_terms(None), [])
        self.assertEqual(len(search_terms(' '.join(str(n) for n in range(50)))), 8)

    def test_contains_all_is_an_and_not_an_or(self):
        self.assertTrue(contains_all('Szereg Cauchy’ego', ['cauchy', 'szereg']))
        self.assertFalse(contains_all('Szereg harmoniczny', ['cauchy', 'szereg']))
        # An empty term list is not "match everything" — it is "nothing was asked".
        self.assertFalse(contains_all('anything', []))


class UcontainsLookupTests(TestCase):
    """The lookup itself, against real rows."""

    def setUp(self):
        self.branch = make_branch('diacritics-branch')
        self.exercise = make_exercise(
            self.branch, 9001, title='Ćwiczenia z ciągów', statement='Wykaż, że ŁUK jest zwarty.'
        )

    def test_finds_a_capitalised_polish_word_typed_in_lower_case(self):
        found = ExerciseTranslation.objects.filter(title__ucontains='ćwiczenia')
        self.assertEqual([t.pk for t in found], [self.exercise.translations.first().pk])

    def test_finds_an_upper_case_word_typed_in_lower_case(self):
        self.assertTrue(ExerciseTranslation.objects.filter(statement__ucontains='łuk').exists())

    def test_still_finds_plain_ascii_the_way_icontains_did(self):
        self.assertTrue(ExerciseTranslation.objects.filter(statement__ucontains='ZWARTY').exists())

    def test_percent_and_underscore_are_literal_not_wildcards(self):
        # INSTR has no wildcards at all, where LIKE needed Django to escape these. Same net result,
        # asserted so a future rewrite back onto LIKE cannot quietly lose the escaping.
        make_exercise(self.branch, 9002, title='100% zbieżny', statement='—')
        self.assertEqual(ExerciseTranslation.objects.filter(title__ucontains='0% zb').count(), 1)
        self.assertEqual(ExerciseTranslation.objects.filter(title__ucontains='0_ zb').count(), 0)

    def test_matches_nothing_rather_than_erroring_on_a_null_column(self):
        # `hint` is blank rather than NULL in this schema, but the lookup has to survive either.
        self.assertFalse(ExerciseTranslation.objects.filter(hint__ucontains='cokolwiek').exists())

    def test_icontains_is_the_bug_this_exists_to_route_around(self):
        """A statement of the defect, not of desired behaviour.

        Skipped off SQLite because there is nothing broken to demonstrate: PostgreSQL's own
        `ILIKE`/`UPPER()` are locale-aware, which is exactly why `ucontains` falls through to
        `icontains` everywhere except here.
        """
        if connection.vendor != 'sqlite':
            self.skipTest('only SQLite folds ASCII alone')
        self.assertFalse(ExerciseTranslation.objects.filter(title__icontains='ćwiczenia').exists())
        self.assertTrue(ExerciseTranslation.objects.filter(title__ucontains='ćwiczenia').exists())


class BrowseSearchDiacriticsTests(APITestCase):
    """The two pre-existing `?q=` search paths, which had the same bug and are fixed by the same
    lookup. Driven through the real endpoints rather than the queryset, because that is where a
    reader met it."""

    def setUp(self):
        self.branch = make_branch('browse-diacritics')
        self.exercise = make_exercise(
            self.branch, 9101, title='Ciągi liczbowe', statement='Zbadaj ZBIEŻNOŚĆ ciągu.'
        )
        make_exercise(self.branch, 9102, title='Nothing relevant', statement='Nothing relevant.')
        self.material = make_material(
            self.branch,
            slug='skrypt-diacritics',
            title='Ćwiczenia z analizy',
            description='Zbiór zadań ze ŚREDNIĄ trudnością.',
        )

    def test_exercise_search_finds_a_capitalised_title_typed_in_lower_case(self):
        response = self.client.get('/api/exercises/', {'q': 'ciągi'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data], [self.exercise.pk])

    def test_exercise_search_finds_an_upper_case_statement_typed_in_lower_case(self):
        response = self.client.get('/api/exercises/', {'q': 'zbieżność'})
        self.assertEqual([row['id'] for row in response.data], [self.exercise.pk])

    def test_material_search_finds_a_capitalised_title_typed_in_lower_case(self):
        response = self.client.get('/api/materials/', {'q': 'ćwiczenia'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data], [self.material.pk])

    def test_material_search_finds_an_upper_case_description_typed_in_lower_case(self):
        response = self.client.get('/api/materials/', {'q': 'średnią'})
        self.assertEqual([row['id'] for row in response.data], [self.material.pk])
