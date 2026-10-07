"""Which API test classes still need `databases = set(all_log_shards()) | {'default'}`.

The request-logging middleware writes a `RequestLog` row for every request, into one of the nine
SQLite shards (`telemetry/routers.py`). Django's test runner forbids a test from touching a
database alias its class did not declare, so a test class that makes a request and does not
declare the shards fails on that guard rather than on anything under test. Serially the
middleware's `except Exception` swallows the refusal and logs a full traceback per request — tens
of thousands of lines over a full run, every one of them reading like a failure. Under
`--parallel` the same thing is a hard `setUpClass` error, which before `tblib` was installed also
killed the runner itself (`TypeError: cannot pickle 'traceback' object`).

Run it from `backend/` with the venv's python::

    ../.venv/bin/python3 testing/check_databases_declared.py

It parses rather than imports, so it is safe to run with no settings and no database. A
declaration on a base class counts for its subclasses, both **a base defined in the same file**
(forty-two files do, each declaring it once on their own base — `moderation/tests.py`,
`materials/tests.py`, `services/tests.py` and `exercises/test_solution_entries.py` joined them on
2026-10-07, which cut 55 copies of the line to 4) and **a base imported from another module**
(`booking/test_week_schedules.py` inherits `booking.tests.ApiTestCase`, which already has the line
— adding a second copy there would be the wrong fix). Only classes that make a request are
reported, so a class in one of those files that reaches no endpoint and stays on `APITestCase` is
not a finding, and a new class that reaches one and stays on `APITestCase` still is.

`testing/test_databases_declared.py` asserts `offending_classes()` is empty, which is the only
thing that actually runs this check — the project has no CI and no git hook. That test also builds
a two-file fixture tree to prove the check can still fail, because a checker that has quietly
stopped finding anything looks exactly like a clean tree.

A class counts as making a request if its body uses `self.client.` **or builds a test client of
its own** (`APIClient()`, `Client()`). The second half was added after the first version of this
script reported zero while `taxonomy.tests.TaxonomyModerationTests` — named in the board's own
bullet as broken — was still broken, because it posts through a client a helper method builds. A
checker that is narrower than the runtime rule is worse than no checker: it says "done".

Zero is the bar. A new test class that makes a request and is not listed here is a test class that
declares the shards; if this script starts printing a number again, that number is the count of
suites whose next full run will be noise.
"""

import ast
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# `self.client.get(...)`, or a client the class builds for itself — `taxonomy/tests.py` does the
# latter in a `_as(who)` helper, and no amount of looking for `self.client` would ever find it.
MAKES_A_REQUEST = re.compile(r'self\.client\.|\b(?:APIClient|Client)\(')


def _module_path(
    module: str, level: int, origin: pathlib.Path, root: pathlib.Path
) -> pathlib.Path | None:
    """The file a `from <module> import ...` refers to, or None if it is not ours to read."""
    if level:
        base = origin.parent
        for _ in range(level - 1):
            base = base.parent
    else:
        base = root
    candidate = base.joinpath(*module.split('.')) if module else base
    for p in (candidate.with_suffix('.py'), candidate / '__init__.py'):
        if p.is_file():
            return p
    return None


class Analyzer:
    """One pass over `backend/`, memoised, so a base class is parsed once however often it is used."""

    def __init__(self, root: pathlib.Path = ROOT) -> None:
        self.root = root
        self._cache: dict[pathlib.Path, tuple[dict[str, ast.ClassDef], dict[str, pathlib.Path]]] = {}

    def _parse(self, path: pathlib.Path):
        if path not in self._cache:
            try:
                tree = ast.parse(path.read_text())
            except (SyntaxError, OSError, UnicodeDecodeError):
                self._cache[path] = ({}, {})
                return self._cache[path]
            classes = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)}
            imported: dict[str, pathlib.Path] = {}
            for n in ast.walk(tree):
                if isinstance(n, ast.ImportFrom):
                    target = _module_path(n.module or '', n.level, path, self.root)
                    if target is None:
                        continue
                    for alias in n.names:
                        imported[alias.asname or alias.name] = target
            self._cache[path] = (classes, imported)
        return self._cache[path]

    def is_test_case(self, path: pathlib.Path, name: str, seen=()) -> bool:
        """Does this class reach a `…TestCase` through its bases at all?

        A substring check on the immediate base names (what this did first) skips any class whose
        only base is a file-local one whose *name* happens not to contain `TestCase` —
        `galleries/tests.py: GalleryBase`, `cloakroom/tests.py: DeskCase`,
        `coauthoring/tests.py: CoauthoringBase` and nine more, 74 request-making classes between
        them, none of them ever examined. A class the checker skips is a class it can never report,
        and whether the base was called `RotaTestCase` or `DeskCase` is not a fact about the code
        under test. Resolved the same way `declares` resolves a base, so the two halves agree about
        what a test class is.
        """
        key = (str(path), name)
        if key in seen:
            return False
        if 'TestCase' in name:
            return True
        classes, imported = self._parse(path)
        node = classes.get(name)
        if node is None:
            target = imported.get(name)
            if target is not None and target != path:
                return self.is_test_case(target, name, seen + (key,))
            return False
        return any(
            self.is_test_case(path, ast.unparse(b).split('.')[-1], seen + (key,))
            for b in node.bases
        )

    def declares(self, path: pathlib.Path, name: str, seen=()) -> bool:
        """Does this class, or anything it inherits from, set `databases`?"""
        key = (str(path), name)
        if key in seen:
            return False
        classes, imported = self._parse(path)
        node = classes.get(name)
        if node is None:
            # Not defined here — it may have been imported from a module that is ours.
            target = imported.get(name)
            if target is not None and target != path:
                return self.declares(target, name, seen + (key,))
            return False
        if any(
            isinstance(s, ast.Assign) and any(getattr(t, 'id', '') == 'databases' for t in s.targets)
            for s in node.body
        ):
            return True
        return any(
            self.declares(path, ast.unparse(b).split('.')[-1], seen + (key,)) for b in node.bases
        )


def offending_classes(root: pathlib.Path = ROOT) -> list[tuple[str, int, str]]:
    """Every test class under `root` that makes a request and declares no `databases`.

    Returned as `(path relative to root, line number, class name)`, sorted. This is the function
    `testing/test_databases_declared.py` asserts is empty, so that the suite itself is what runs
    the check — nothing else does (no CI, no hook).
    """
    analyzer = Analyzer(root)
    found: list[tuple[str, int, str]] = []
    for p in sorted(root.rglob('test*.py')):
        # `migrations/` holds no tests; a virtualenv, a `node_modules` or anything in
        # `site-packages` is somebody else's test suite. The main checkout had a stale
        # `backend/.venv/` beside the real `../.venv/`, and the day `is_test_case()` learned to
        # see through base classes (§17BU.C) the checker started reporting django-postman's four.
        parts = set(p.relative_to(root).parts)
        if parts & {'migrations', '.venv', 'venv', 'node_modules', 'site-packages'}:
            continue
        try:
            src = p.read_text()
            tree = ast.parse(src)
        except (SyntaxError, OSError, UnicodeDecodeError):
            continue
        rel = str(p.relative_to(root))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            if not any(
                analyzer.is_test_case(p, ast.unparse(b).split('.')[-1]) for b in node.bases
            ):
                continue
            if not MAKES_A_REQUEST.search(ast.get_source_segment(src, node) or ''):
                continue
            if analyzer.declares(p, node.name):
                continue
            found.append((rel, node.lineno, node.name))
    return sorted(found)


def main() -> int:
    report: dict[str, list[tuple[int, str]]] = {}
    for rel, lineno, name in offending_classes():
        report.setdefault(rel, []).append((lineno, name))

    total = sum(len(v) for v in report.values())
    print(total, 'classes still unresolved, in', len(report), 'files')
    for f, v in sorted(report.items()):
        print(f'  {f}: ' + ', '.join(f'{n}@{l}' for l, n in sorted(v)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
