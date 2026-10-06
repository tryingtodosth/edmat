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
declaration on a base class counts for its subclasses, **including a base imported from another
module** (`booking/test_week_schedules.py` inherits `booking.tests.ApiTestCase`, which already has
the line — adding a second copy there would be the wrong fix). Only classes that make a request
are reported.

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


def _module_path(module: str, level: int, origin: pathlib.Path) -> pathlib.Path | None:
    """The file a `from <module> import ...` refers to, or None if it is not ours to read."""
    if level:
        base = origin.parent
        for _ in range(level - 1):
            base = base.parent
    else:
        base = ROOT
    candidate = base.joinpath(*module.split('.')) if module else base
    for p in (candidate.with_suffix('.py'), candidate / '__init__.py'):
        if p.is_file():
            return p
    return None


class Analyzer:
    """One pass over `backend/`, memoised, so a base class is parsed once however often it is used."""

    def __init__(self) -> None:
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
                    target = _module_path(n.module or '', n.level, path)
                    if target is None:
                        continue
                    for alias in n.names:
                        imported[alias.asname or alias.name] = target
            self._cache[path] = (classes, imported)
        return self._cache[path]

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


def main() -> int:
    analyzer = Analyzer()
    report: dict[str, list[tuple[int, str]]] = {}
    for p in sorted(ROOT.rglob('test*.py')):
        if 'migrations' in str(p):
            continue
        try:
            src = p.read_text()
            tree = ast.parse(src)
        except (SyntaxError, OSError, UnicodeDecodeError):
            continue
        rel = str(p.relative_to(ROOT))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            bases = [ast.unparse(b) for b in node.bases]
            if not any('TestCase' in b for b in bases):
                continue
            if not MAKES_A_REQUEST.search(ast.get_source_segment(src, node) or ''):
                continue
            if analyzer.declares(p, node.name):
                continue
            report.setdefault(rel, []).append((node.lineno, node.name))

    total = sum(len(v) for v in report.values())
    print(total, 'classes still unresolved, in', len(report), 'files')
    for f, v in sorted(report.items()):
        print(f'  {f}: ' + ', '.join(f'{n}@{l}' for l, n in sorted(v)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
