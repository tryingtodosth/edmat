"""Case-insensitive text matching that actually works for Polish — and one folding rule shared by
the database and by Python, so the two can never disagree.

**The bug this exists to fix is real and was reproduced before anything here was written.** SQLite's
`LIKE` — which is what Django's `icontains` compiles to on this backend — understands upper/lower
case for ASCII characters only. Every other letter is compared exactly:

    sqlite> select 'Ciagi' like '%ciagi%';   -- 1, both letters are ASCII
    sqlite> select 'CIĄGI' like '%ciągi%';   -- 0, Ą is not ą as far as LIKE is concerned
    sqlite> select 'Ćwiczenia' like '%ćwiczenia%';  -- 0
    sqlite> select upper('ciągi');           -- 'CIąGI', for the same reason

In a Polish corpus that is most of the interesting words: a reader who types `ćwiczenia` (as one
does — lower case, into a search box) never finds a chapter called `Ćwiczenia`, and the failure is
silent. The same holds for `Łuk`/`łuk`, `Środek`/`środek`, `Żaden`/`żaden` and any text written in
capitals. It is not a corner case, it is the default case for this content.

## What was rejected, and why

- **`django.contrib.postgres.lookups.Unaccent` / the `unaccent` extension.** Needs PostgreSQL. This
  project runs on SQLite (CLAUDE.md §13), so the extension is simply not available. It also answers
  a *different* question — see the note on accents at the bottom.
- **A custom SQLite collation** (`create_collation`), the first thing the docs suggest for
  case-insensitive comparison. It genuinely fixes `=`, `<`, `ORDER BY` and `LIKE`'s *right* operand
  never — because **`LIKE` does not consult collations at all** in SQLite; its case folding is
  hard-wired into the `like()` function. A collation would have fixed `iexact` and left every
  substring search exactly as broken, which is the search this app actually does.
- **Overriding SQLite's own `like()` or `lower()` through `create_function`.** Python's `sqlite3`
  will let you, and it would fix `icontains` with no query changes at all. Rejected as too wide a
  blast radius: `LIKE` and `lower()` are used by Django's own introspection and by any future query
  in the app, and silently changing what a SQL built-in means for the whole process is a debugging
  trap for whoever meets it next. A new, explicitly-named lookup is opt-in at every call site.
- **Turning on `PRAGMA case_sensitive_like`** — the opposite of what is wanted, and still ASCII-only.

## What this does instead

A `ucontains` lookup, used exactly like `icontains`:

    Chapter.objects.filter(title__ucontains='ćwiczenia')

On SQLite it compiles to `INSTR(edmat_fold(col), ?) > 0`, where `edmat_fold` is a Python function
registered on every connection and the needle is folded **in Python before it is bound**, so the
callback runs once per row rather than twice. On every other backend it falls through to Django's
own `icontains`, unchanged — because on PostgreSQL `ILIKE`/`UPPER()` are locale-aware already, so
there is nothing to fix there. **A real PostgreSQL deployment therefore needs no code change and
gets the same behaviour**; that is the whole reason this is a lookup rather than a rewritten query.

`INSTR` also means the needle's `%` and `_` are literal characters rather than wildcards Django has
to escape first — a small honest simplification over the LIKE path.

## What it costs, measured rather than guessed

Against the real corpus (749 exercise translations, 7 material ones), best of twelve runs:

    title/statement filter, icontains   3.1 ms      the endpoint's own query, icontains   ~10 ms
    title/statement filter, ucontains  11.0 ms      the endpoint's own query, ucontains   ~22 ms

Same query count (one), so this is not an N+1 — it is one Python call per row per field, about 5 µs
each, and it scales linearly with the corpus. Roughly 8 ms added to a browse search over the whole
corpus, which is well inside what an endpoint doing several other things already spends.

An ASCII fast path was considered and rejected: when the *needle* contains no non-ASCII character,
plain `icontains` genuinely gives identical results, so the cheap path is available. It was left out
because it would mean two matching behaviours in one lookup, differing only in exotic cases
(`İ` casefolds to `i` plus a combining dot, so the folded path matches where LIKE would not), and a
search that behaves differently depending on which letters you typed is worse than one that is
uniformly 8 ms slower. Past a corpus a couple of orders of magnitude larger the real answer is not a
fast path either — it is a stored, indexed, pre-folded column, or PostgreSQL.

## The one rule, in one place

`fold()` is used by the SQL function AND by `contains_all()`, which is how the course search matches
the rows it has to filter in Python anyway (labels resolved per locale, visibility that no `WHERE`
clause can express). Both sides call the same function on the same strings, so "found by the
database" and "found in Python" cannot drift apart into two subtly different notions of equal.

`str.casefold()` rather than `str.lower()`: it is the method the Unicode standard defines for
caseless *matching* (it maps `ß` to `ss`, so a reader typing `strasse` finds `Straße`), and for
Polish specifically the two agree on every letter anyway.

**Accents are deliberately NOT stripped.** `ó` and `o` stay different letters here, so `zbior` does
not find `zbiór`. That is a genuinely separate feature (it is what PostgreSQL's `unaccent` is for)
and it is not obviously wanted: in Polish `łuk` (an arc) and `luk` (a hatch) are different words,
and `icontains` has never promised accent-insensitivity on any backend. Flagged rather than
smuggled in, since somebody will reasonably ask.
"""

from django.db import connections
from django.db.backends.signals import connection_created
from django.db.models import Field
from django.db.models.lookups import IContains

# Prefixed because it lands in SQLite's global function namespace alongside the built-ins, and a
# name like `fold` is exactly the sort of thing a future library would also want.
FOLD_SQL_FUNCTION = 'edmat_fold'

# A query of 200 words would build 200 ORed clauses per field for nothing. Nobody searches with more
# than a handful of words, and the ones past this point can only narrow a result set that is already
# narrow.
MAX_TERMS = 8


def fold(value: str | None) -> str:
    """The one definition of "the same, ignoring case" this project uses.

    Tolerates None so it can be registered as a SQL function directly: a NULL column reaches here as
    None, and returning '' makes `INSTR('', needle)` answer 0 — a row with no text matches nothing,
    which is what `LIKE` did with NULL too.
    """
    if value is None:
        return ''
    return str(value).casefold()


def search_terms(query: str | None, *, limit: int = MAX_TERMS) -> list[str]:
    """The query as folded terms, ANDed by whoever uses them.

    Whitespace-split rather than parsed: there is no quoting or operator syntax here, and inventing
    one would be a promise the UI does not make.
    """
    return [fold(part) for part in (query or '').split()][:limit]


def contains_all(text: str | None, terms: list[str]) -> bool:
    """Whether one string holds every term. Folds once, not once per term."""
    if not terms:
        return False
    folded = fold(text)
    return all(term in folded for term in terms)


class UnicodeIContains(IContains):
    """`icontains`, but case-insensitive for every letter rather than only the ASCII ones.

    Subclasses `IContains` on purpose: everything except `as_sqlite` is inherited, so on any backend
    whose own case-insensitive LIKE is already Unicode-aware this is byte-for-byte the query
    `icontains` produces today.
    """

    lookup_name = 'ucontains'

    def as_sqlite(self, compiler, connection):
        # A column-to-column comparison (`F('other')`) has no Python-side value to fold, so it keeps
        # the inherited LIKE behaviour rather than being silently wrong in a new way. Nothing in this
        # app does that today; the branch is here so nothing has to notice.
        if not self.rhs_is_direct_value():
            return super().as_sql(compiler, connection)
        lhs, lhs_params = self.process_lhs(compiler, connection)
        # Deliberately NOT `process_rhs`: that wraps the value in `%…%` and escapes LIKE wildcards,
        # neither of which INSTR wants. `self.rhs` is the raw value here — `PatternLookup` sets
        # `prepare_rhs = False`, so the pattern is only ever applied inside `process_rhs`.
        needle = fold(self.rhs)
        return f'INSTR({FOLD_SQL_FUNCTION}({lhs}), %s) > 0', (*lhs_params, needle)


# Registered on `Field` rather than on CharField and TextField separately, matching where Django
# registers `icontains` itself — so `ucontains` is available anywhere `icontains` is.
Field.register_lookup(UnicodeIContains)


def install_fold_function(connection, **kwargs):
    """Make `edmat_fold` available to SQL. Connected to `connection_created`, see `register()`."""
    if connection.vendor != 'sqlite':
        return
    try:
        connection.connection.create_function(
            FOLD_SQL_FUNCTION, 1, fold, deterministic=True
        )
    except (AttributeError, TypeError):
        # `deterministic=` needs SQLite 3.8.3+; without it the function still works, it just cannot
        # be used in an index or a partial constraint. Nothing here does, so degrading is right —
        # refusing to open the connection would not be.
        connection.connection.create_function(FOLD_SQL_FUNCTION, 1, fold)


def register():
    """Wire the SQL function up. Called once from an AppConfig.ready — see taxonomy/apps.py.

    Both halves matter. The signal covers every connection opened from now on, including the test
    database and each reconnect after `CONN_MAX_AGE`. The loop covers a connection that is already
    open by the time this runs — without it, whether search worked would depend on whether anything
    had touched the database before app loading finished, which is the kind of bug that reproduces on
    one machine and not the next.
    """
    connection_created.connect(install_fold_function, dispatch_uid='edmat_fold_function')
    for connection in connections.all():
        if connection.connection is not None:
            install_fold_function(connection)
