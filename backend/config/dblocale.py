"""A locale-aware sort order for SQLite — the fix for the gap Section 17AQ's own "Left open" note
named: "`title` order is bytewise after lower-casing, so Polish letters sort after `z` (SQLite has
no locale collation; PostgreSQL would)".

## The bug, reproduced before anything here was written

SQLite has no notion of a locale. `ORDER BY` on a text column compares raw Unicode code points, and
`ą` (U+0105) is a strictly larger code point than `z` (U+007A) — so a plain `ORDER BY title` puts
every accented Polish word after every plain one, regardless of what letter it actually starts with:

    sqlite> select 'ząb' < 'zebra';   -- 0 — wrong: "ząb" reads before "zebra" in any Polish dictionary
    sqlite> select 'abak' < 'ząb';    -- 1 — "wrong" only by accident: true either way

A real locale collation (what PostgreSQL's `COLLATE "pl_PL"` gives for free) sorts `ą` immediately
after `a`, `ć` after `c`, and so on — a diacritic is a variant of its base letter, not a different
letter that happens to sit past the end of the alphabet.

## What this does instead

A SQLite **collating sequence** (`sqlite3.Connection.create_collation`), registered once per
connection exactly the way `config/dbsearch.py` registers `edmat_fold` — same signal
(`connection_created`), same "connect it, then also cover whatever connection is already open"
double-registration, same one-function-one-job shape. Attached to an `ORDER BY` clause through
Django's own `django.db.models.functions.Collate`, which already exists purely to say "use this
collation for this expression" — nothing here reimplements what Django already provides, only what
SQLite doesn't: a collation that actually understands a diacritic.

**The key, not a locale table.** `_sort_key()` case-folds, special-cases `ł`/`Ł` (Unicode gives it no
decomposition — it is a distinct letter shape, not "l plus a mark" — so it is folded to `l` by hand
before anything else runs), then runs `unicodedata.normalize('NFKD', ...)`, which turns every OTHER
accented Latin letter this corpus's two real languages (and most of the rest of Latin-script Europe)
actually use into "base letter" + "combining mark" — `ą` → `a` + U+0328, `ć` → `c` + U+0301, `ń` → `n`
+ U+0301, `ó` → `o` + U+0301, `ś` → `s` + U+0301, `ź`/`ż` → `z` + a mark. The **primary** key strips
every combining mark, so `ą` sorts exactly where `a` does against every OTHER letter; the **secondary**
key keeps the marks, so among words that agree on every base letter, the plain one sorts before its
accented sibling (`a` is a string-prefix of `ą`, so `abak` < `ząb`... no — wait, `a` < `ą`, not
across different base letters — see the docstring on `_sort_key` for the actual guarantee). This is
not a full CLDR/ICU collation — it needs no new dependency (this project's own recorded restraint,
same call as `testing/factories.py` over `factory_boy`) and gets the one property that was actually
missing: a diacritic sorts as a variant of its base letter, not past `z`.

**Applied only on SQLite, only to the `title` sort key.** On any other backend `sort_exercises`
leaves `F('sort_title')` exactly as it was — PostgreSQL's own default collation is already
locale-aware in most real deployments, and wrapping every backend in a SQLite-specific collation
name would be the wrong kind of "fix everywhere" this project has consistently avoided
(`config/dbsearch.py`'s own `ucontains` falls through to plain `icontains` off SQLite for the
identical reason).
"""

import unicodedata

from django.db import connections
from django.db.backends.signals import connection_created

# Same naming discipline as `config/dbsearch.py`'s `FOLD_SQL_FUNCTION`: prefixed because it lands in
# SQLite's own global collation namespace alongside `BINARY`/`NOCASE`/`RTRIM`.
COLLATION_NAME = 'edmat_locale'

_LETTER_FOLD = str.maketrans({'ł': 'l', 'Ł': 'l'})


def _sort_key(value: str | None) -> tuple[str, str]:
    """`(primary, secondary)` — compared as a Python tuple, which is exactly lexicographic: primary
    first, secondary only breaks a primary tie.

    `primary` has every combining mark stripped, so it compares by base letter alone: `ą`/`ć`/`ń`/
    `ó`/`ś`/`ź`/`ż` (and `ł`, folded by hand first) all collapse to `a`/`c`/`n`/`o`/`s`/`z`/`z`/`l` —
    which is what makes a whole word beginning `ząb` compare against `z`, not fall past every real
    `z`-word the way a raw code-point comparison does.

    `secondary` keeps the marks (still case-folded, still `ł`-folded), so two words that agree on
    every base letter still order deterministically, and in the one direction a reader expects: the
    plain letter is always a string-prefix of its own accented form (`'a' + '\\u0328' `), and a
    prefix always sorts before anything longer that starts with it — so `a` < `ą`, `c` < `ć`, and so
    on, without a hand-written table saying so.
    """
    text = '' if value is None else str(value)
    folded = text.casefold().translate(_LETTER_FOLD)
    decomposed = unicodedata.normalize('NFKD', folded)
    primary = ''.join(ch for ch in decomposed if not unicodedata.combining(ch))
    return (primary, decomposed)


def compare(a: str | None, b: str | None) -> int:
    """The collation callback itself: SQLite calls this with two column values and wants
    -1/0/1 back. Exposed as a plain function so a test can call it directly without a connection."""
    ka, kb = _sort_key(a), _sort_key(b)
    if ka < kb:
        return -1
    if ka > kb:
        return 1
    return 0


def install_locale_collation(connection, **kwargs):
    """Make `EDMAT_LOCALE` available as an `ORDER BY ... COLLATE` name. Connected to
    `connection_created`, see `register()` below."""
    if connection.vendor != 'sqlite':
        return
    connection.connection.create_collation(COLLATION_NAME, compare)


def register():
    """Wire the collation up. Called once from `taxonomy/apps.py`'s `AppConfig.ready`, alongside
    `dbsearch.register()` — same reasoning for living there: every content app sits on taxonomy,
    so it is the one place neither registration can be missing.

    Both halves matter, for the identical reason `dbsearch.register()` states: the signal covers
    every connection opened from now on (including a fresh test database and each reconnect after
    `CONN_MAX_AGE`), and the loop covers a connection already open by the time this runs.
    """
    connection_created.connect(install_locale_collation, dispatch_uid='edmat_locale_collation')
    for connection in connections.all():
        if connection.connection is not None:
            install_locale_collation(connection)
