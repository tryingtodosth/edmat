"""The `databases` rule, checked by the suite itself.

`testing/check_databases_declared.py` existed from 2026-10-06 and nothing ran it: no CI, no git
hook, and a paragraph in `test.md` asking the next person to remember. A check nobody runs is a
check that goes quietly stale — and its failure mode is exactly the one it was written to catch,
because a test class that forgets the line still *passes* serially while logging a traceback per
request.

So the suite runs it. `test_no_test_class_that_makes_a_request_forgets_the_log_shards` is the real
assertion; the four fixture tests beside it exist because "found nothing" and "cannot find anything
any more" look identical from the outside, and the base-class convention introduced on 2026-10-07
(`HISTORY.md` §17BU.C) is precisely the kind of change that could have made the checker blind.

`SimpleTestCase`, not `TestCase`: nothing here touches a database or makes a request, so it needs
no `databases` line — and the checker agrees, because it only reports classes whose body makes a
request. Nothing in this file may build a test client, or it would owe the declaration it is here
to police.
"""

import pathlib
import tempfile
import textwrap

from django.test import SimpleTestCase

from testing.check_databases_declared import ROOT, offending_classes

BASE_AND_SUBCLASS = textwrap.dedent(
    """
    from rest_framework.test import APITestCase


    class ApiTestCase(APITestCase):
        databases = {'default', 'log_0'}


    class SomethingTests(ApiTestCase):
        def test_it(self):
            self.client.get('/api/exercises/')
    """
)

FORGOTTEN = textwrap.dedent(
    """
    from rest_framework.test import APITestCase


    class ForgetfulTests(APITestCase):
        def test_it(self):
            self.client.get('/api/exercises/')
    """
)

ODDLY_NAMED_BASE = textwrap.dedent(
    """
    from rest_framework.test import APITestCase


    class GalleryBase(APITestCase):
        pass


    class SomethingTests(GalleryBase):
        def test_it(self):
            self.client.get('/api/galleries/')
    """
)


class DatabasesDeclaredTests(SimpleTestCase):
    def test_no_test_class_that_makes_a_request_forgets_the_log_shards(self):
        """Zero is the bar, and this is the only thing in the project that enforces it.

        A failure here names the file, the line and the class: give it
        `databases = set(all_log_shards()) | {'default'}`, on the file's own base class where it
        has one.
        """
        found = offending_classes()
        self.assertEqual(
            found,
            [],
            'These test classes make a request and declare no `databases`; each will log a '
            'traceback per request serially and fail outright under --parallel:\n'
            + '\n'.join(f'  {rel}:{line} {name}' for rel, line, name in found),
        )

    def test_it_scans_the_whole_backend_rather_than_one_directory(self):
        """A root that had quietly narrowed (to `testing/`, say) would also report zero."""
        self.assertEqual(ROOT.name, 'backend')
        scanned = {str(p.relative_to(ROOT)) for p in ROOT.rglob('test*.py')}
        self.assertIn('moderation/tests.py', scanned)
        self.assertIn('booking/test_week_schedules.py', scanned)
        self.assertGreater(len(scanned), 60)  # 74 on 2026-10-07

    def test_a_class_that_declares_nothing_is_still_caught(self):
        """The half that makes the zero above mean something."""
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'test_forgotten.py').write_text(FORGOTTEN)
            self.assertEqual(offending_classes(root), [('test_forgotten.py', 5, 'ForgetfulTests')])

    def test_a_base_class_in_the_same_file_counts_for_its_subclasses(self):
        """The convention 42 files now use (`HISTORY.md` §17BU.C). If this ever broke, the checker
        would report every subclass in those files and the previous test would be unfixable without
        putting all 55 copies of the line back."""
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'test_inherited.py').write_text(BASE_AND_SUBCLASS)
            self.assertEqual(offending_classes(root), [])

    def test_a_base_class_that_forgets_does_not_shield_its_subclasses(self):
        """The one way a per-file base could hide the whole file."""
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'test_shielded.py').write_text(
                BASE_AND_SUBCLASS.replace("    databases = {'default', 'log_0'}\n", '    pass\n')
            )
            self.assertEqual(
                [name for _, _, name in offending_classes(root)], ['SomethingTests']
            )

    def test_a_base_whose_name_lacks_testcase_does_not_hide_its_subclasses(self):
        """Until 2026-10-07 the checker only looked at a class whose immediate base *name*
        contained `TestCase`, so 74 real request-making classes — every subclass of
        `galleries/tests.py: GalleryBase`, `cloakroom/tests.py: DeskCase` and ten other file-local
        bases — were never examined at all. They all happened to inherit the line from their base;
        the next one would not have had to."""
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'test_oddly_named.py').write_text(ODDLY_NAMED_BASE)
            self.assertEqual(
                [name for _, _, name in offending_classes(root)], ['SomethingTests']
            )
