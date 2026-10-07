"""The project's own build log as data: every section of `HISTORY.md`, with the date it was written
and the goal it belongs to.

The owner's ask of 2026-10-07, on top of "EdMat on EdMat": *import the tasks and problems we have
already solved, with their time, from the general project's history* — and then: *information about
the different modules as different goals or subprojects, each with its own amount of content,
summaries, child content; /dziennik is a subproject too* (the 2donet project card: a summary, its
sub-projects, and counts derived from what hangs under it). `HISTORY.md` IS the history — one `## `
section per feature, pass or bug hunt, in the order they happened — so this module reads it rather
than keeping a second, hand-typed list that would drift from the first (house rule 5's spirit:
derive, never re-enter). `work/edmat_project.py` turns the result into one public plan per goal,
with a done, dated step per section.

**Why a JSON table and not a parse at seed time.** The deployment bundle (`deploy/fuw/pack.sh`)
rsyncs `backend/` and `frontend/build/` and nothing else — `HISTORY.md` is not on the server. So
`manage.py export_edmat_history` runs where the repository is, writes `work/edmat_history.json`,
and `seed_edmat_project` reads that file wherever it runs. The table is checked in; a test asserts
it is current whenever `HISTORY.md` is present, so it cannot go stale unnoticed.

**Where the date comes from.** Sections written since mid-September carry their date in the
heading (`(2026-10-07, …)`). Earlier ones do not, so for those the date is the first commit that
contains the heading line (`git log -S`, over `HISTORY.md` and the `CLAUDE.md` it was split out of
on 2026-09-19). Sections already present in the repository's first commit (2026-07-25) were written
before the repository existed; their date is that first commit and is marked `repo-start`, meaning
"no later than" rather than "on". Each entry says which of the three it is.

**Which goal a section belongs to is assigned by hand**, by reference (`SUBPROJECT_BY_REF`) or, for
the few headings without one, by the start of the heading (`SUBPROJECT_BY_HEADING`). A keyword
guess over headings like "Six small things the closing cycle named and nobody owned" would be
wrong more often than right. Anything unlisted lands in `platform` and the exporter says so, so a
new section cannot be filed silently; `work.tests.EdmatHistoryTests` fails on an unlisted one.

The four headings at the top that are not work (the two staleness warnings, the status paragraph,
the old build order and the reused-assets ledger) are skipped by title.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from django.conf import settings

#: `BASE_DIR` is `backend/`; the log lives beside it at the repository root.
HISTORY_PATH = Path(settings.BASE_DIR).parent / 'HISTORY.md'
TABLE_PATH = Path(__file__).with_name('edmat_history.json')

#: Headings that describe the file or the old plan, not something that was built.
SKIP_TITLES = (
    'Two staleness warnings',
    'The running status paragraph',
    '16. Build order',
    '17. Reused-assets ledger',
)

#: Paths the heading may have lived in, oldest split first: `HISTORY.md` was carved out of
#: `CLAUDE.md` on 2026-09-19 (§17BJ), so a heading older than that first appeared in the latter.
HISTORY_GIT_PATHS = ('HISTORY.md', 'CLAUDE.md')

SUMMARY_MAX = 400
DEFAULT_SUBPROJECT = 'platform'

#: Section reference → goal key (`work.edmat_project.SUBPROJECTS`). Two references appear twice in
#: the log (`17BE`, `17BQ`); the second of each is told apart by heading below, which wins.
SUBPROJECT_BY_REF = {
    # the original blueprint sections kept as the record of the foundations
    '9': 'foundations', '10': 'foundations', '11': 'foundations', '13': 'foundations',
    '14': 'foundations', '15': 'foundations',
    '17A': 'corpus', '17B': 'community', '17C': 'materials', '17D': 'corpus', '17E': 'interface',
    '17F': 'community', '17G': 'materials', '17H': 'community', '17I': 'community',
    '17J': 'learning', '17K': 'corpus', '17L': 'platform', '17M': 'community', '17N': 'materials',
    '17O': 'materials', '17P': 'tutoring', '17Q': 'platform', '17R': 'tutoring', '17S': 'accounts',
    '17T': 'courses', '17U': 'tutoring', '17V': 'events', '17W': 'platform', '17X': 'accounts',
    '17Y': 'events', '17Z': 'tutoring', '17AA': 'interface', '17AB': 'platform', '17AC': 'courses',
    '17AD': 'materials', '17AE': 'platform', '17AF': 'accounts', '17AG': 'community',
    '17AH': 'corpus', '17AI': 'community', '17AJ': 'materials', '17AK': 'corpus',
    '17AL': 'learning', '17AM': 'events', '17AN': 'events', '17AO': 'events', '17AP': 'accounts',
    '17AQ': 'corpus', '17AR': 'community', '17AS': 'corpus', '17AT': 'interface',
    '17AU': 'courses', '17AV': 'community', '17AW': 'community', '17AX': 'materials',
    '17AY': 'materials', '17AZ': 'accounts', '17BA': 'corpus', '17BB': 'corpus',
    '17BC': 'materials', '17BD': 'concepts', '17BE': 'materials',
    '17BF': 'conference', '17BF.A': 'conference', '17BF.B': 'conference', '17BF.C': 'conference',
    '17BF.D': 'conference', '17BF.E': 'conference', '17BF.F': 'conference', '17BF.G': 'conference',
    '17BG': 'interface', '17BH': 'materials',
    '17BI': 'management', '17BI.A': 'management', '17BI.B': 'management', '17BI.C': 'management',
    '17BI.D': 'management', '17BI.E': 'management', '17BI.F': 'management',
    '17BJ': 'dziennik', '17BK': 'conference', '17BL': 'conference', '17BM': 'dziennik',
    '17BN': 'dziennik', '17BO': 'dziennik', '17BP': 'conference', '17BQ': 'corpus',
    '17BR': 'learning', '17BR.A': 'learning', '17BR.B': 'learning', '17BR.C': 'courses',
    '17BR.D': 'concepts', '17BR.E': 'learning', '17BR.F': 'accounts', '17BR.G': 'interface',
    '17BR.H': 'interface', '17BS': 'community',
    '17BT': 'platform', '17BT.A': 'platform', '17BT.B': 'learning', '17BT.C': 'interface',
    '17BT.D': 'platform', '17BT.E': 'community',
    '17BU': 'platform', '17BU.A': 'interface', '17BU.B': 'learning', '17BU.C': 'platform',
    '17BU.D': 'learning', '17BV': 'interface', '17BW': 'management', '17BW.B': 'management',
}

#: Heading prefix → goal key, checked before the reference (the four headings without a reference,
#: and the second use of a reference).
SUBPROJECT_BY_HEADING = {
    'The one-time corpus migration': 'corpus',
    'Courses, overhauled': 'courses',
    'Resolved open questions': 'platform',
    '§17BQ — the owner': 'interface',
    '17BE. Three asks in one afternoon': 'interface',
}

_HEADING = re.compile(r'^## (?P<text>.+?)\s*$')
_REF = re.compile(r'^(?P<ref>\d+[A-Z]*(?:\.[A-Z])?)\.?\s*(?:[—–-]\s*)?(?P<title>.+)$')
_DATE = re.compile(r'(?<!\d)(20\d\d-\d\d-\d\d)(?!\d)')
_MARKUP = re.compile(r'[*`_]')
#: A trailing "(✅ built, full stack)" / "(2026-10-07, `branch`)" — status and date belong to the
#: step's own fields, not its title.
_TRAILING_NOTE = re.compile(r'\s*\((?:✅|built|done|20\d\d-)[^)]*\)\s*$')


def _summary(lines: list[str]) -> str:
    """The first paragraph after the heading, as one line, cut at a word boundary."""
    paragraph: list[str] = []
    started = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if started:
                break
            continue
        if stripped.startswith('#'):
            break
        started = True
        paragraph.append(stripped)
    text = _MARKUP.sub('', ' '.join(paragraph)).strip()
    if len(text) <= SUMMARY_MAX:
        return text
    cut = text[:SUMMARY_MAX].rsplit(' ', 1)[0]
    return cut.rstrip(',;:—–-') + '…'


def clean_title(title: str) -> str:
    """The heading minus trailing status/date notes and inline code marks."""
    cleaned = title
    while True:
        shorter = _TRAILING_NOTE.sub('', cleaned)
        if shorter == cleaned:
            break
        cleaned = shorter
    return cleaned.replace('`', '').strip()


def classify(entry: dict) -> tuple[str, bool]:
    """`(goal key, listed)` — `listed` is False when the section fell through to the default."""
    heading = entry['heading']
    for prefix, key in SUBPROJECT_BY_HEADING.items():
        if heading.startswith(prefix):
            return key, True
    ref = entry.get('ref')
    if ref in SUBPROJECT_BY_REF:
        return SUBPROJECT_BY_REF[ref], True
    return DEFAULT_SUBPROJECT, False


def parse_history(text: str) -> list[dict]:
    """Every `## ` section as `{ref, title, heading, line, date, date_source, summary, subproject}`;
    `date` is None where the heading carries none (the exporter fills it from git)."""
    lines = text.splitlines()
    heads = [(i, m.group('text')) for i, line in enumerate(lines) if (m := _HEADING.match(line))]
    entries: list[dict] = []
    for position, (index, heading) in enumerate(heads):
        if heading.startswith(SKIP_TITLES):
            continue
        end = heads[position + 1][0] if position + 1 < len(heads) else len(lines)
        ref_match = _REF.match(heading)
        ref = ref_match.group('ref') if ref_match else None
        title = ref_match.group('title') if ref_match else heading
        date_match = _DATE.search(heading)
        entry = {
            'ref': ref,
            'title': clean_title(title),
            'heading': heading,
            'line': index + 1,
            'date': date_match.group(1) if date_match else None,
            'date_source': 'heading' if date_match else None,
            'summary': _summary(lines[index + 1 : end]),
        }
        entry['subproject'], entry['listed'] = classify(entry)
        entries.append(entry)
    return entries


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ['git', *args], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()


def repo_start_date(repo: Path) -> str:
    """The commit date of the repository's first commit."""
    return _git(repo, 'log', '--format=%cs', '--reverse').splitlines()[0]


def first_commit_date(repo: Path, needle: str) -> str | None:
    """The date of the first commit whose diff adds `needle` in the history files, or None."""
    out = _git(
        repo, 'log', '--format=%cs', '--reverse', '-S', needle, '--', *HISTORY_GIT_PATHS
    )
    return out.splitlines()[0] if out else None


def build_table(history_path: Path = HISTORY_PATH, repo: Path | None = None) -> list[dict]:
    """Parse the log and fill every missing date from git. Needs the repository."""
    repo = repo or history_path.parent
    entries = parse_history(history_path.read_text(encoding='utf-8'))
    start = repo_start_date(repo)
    for entry in entries:
        if entry['date']:
            continue
        found = first_commit_date(repo, f"## {entry['heading']}")
        if found is None:
            continue  # an honest None: the heading was never committed under that text
        entry['date'] = found
        entry['date_source'] = 'repo-start' if found == start else 'git'
    return entries


def write_table(entries: list[dict], path: Path = TABLE_PATH) -> None:
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def load_table(path: Path = TABLE_PATH) -> list[dict]:
    """The exported table, or an empty list where the file is absent — the seed then writes no
    history steps and says so, rather than failing a production run over a missing export."""
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding='utf-8'))
