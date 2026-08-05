"""Real, server-side HTML sanitization for user-submitted exercise/material content — the "sanitize
on save too, defense in depth" layer CLAUDE.md Section 11 always specified but never actually built
(found by a security scan of the whole project, not part of the original Section 11 writeup itself).

Storage format is Markdown SOURCE with raw-HTML passthrough allowed (markdown-it's own `html: true`
option, Section 11) — a submitter can type literal `<script>`/`<iframe>`/`onerror=`-bearing HTML
directly into a statement/hint/answer/solution, and until this fix, the ONLY thing standing between
that and every other reader's browser was the FRONTEND's own DOMPurify pass (renderContent.ts) —
fine for the one client this app ships today, but never true defense-in-depth, and completely absent
for content that publishes with zero moderator review (a verified contributor's new exercise,
CLAUDE.md Section 18 item 4).

The allowlist below is deliberately grounded in what the REAL, existing 749-exercise corpus actually
contains, not guessed: a full sweep of every ExerciseTranslation/MaterialTranslation row found real,
legitimate `<p>`/`<strong>` formatting AND real inline SVG geometry diagrams (`<svg>`/`<circle>`/
`<line>`/`<path>`/`<polygon>`/`<rect>`/`<text>`, with a small, specific set of presentation
attributes — cx/cy/r/points/d/fill/stroke/etc, never a single `style`, `on*`, or `href`/`xlink:href`
attribute anywhere in the real corpus) — confirmed by directly querying the database, not assumed
from the schema. A handful of standard Markdown-output tags (lists, tables, headings, links, images)
are included with headroom beyond what the current corpus happens to use, since new submissions are
free-form Markdown, not just migrated corpus content — matching what markdown-it's own real output
shape already produces for those, and what the frontend's DOMPurify pass already allows.

Deliberately NOT included, on purpose: `<script>`, `<iframe>`, `<object>`/`<embed>`, `style`
attributes (a real CSS-based injection vector in some contexts), any `on*` event-handler attribute,
and `href`/`xlink:href` on SVG elements specifically (avoids a `javascript:` URI inside an SVG link,
a real, historically-exploited XSS vector bleach's own attribute allowlist doesn't special-case
away by itself).
"""

import re

import bleach

_TEXT_TAGS = [
    'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's',
    'ul', 'ol', 'li', 'code', 'pre', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'sup', 'sub', 'hr', 'span', 'div',
]
_SVG_TAGS = ['svg', 'circle', 'line', 'path', 'polygon', 'polyline', 'rect', 'text', 'g', 'ellipse']

ALLOWED_TAGS = _TEXT_TAGS + _SVG_TAGS + ['a', 'img']

ALLOWED_ATTRIBUTES = {
    'a': ['href', 'title'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'svg': ['width', 'height', 'viewbox', 'viewBox', 'role', 'aria-label', 'xmlns'],
    'circle': ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width'],
    'line': ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-dasharray'],
    'path': ['d', 'fill', 'stroke', 'stroke-width'],
    'polygon': ['points', 'fill', 'stroke', 'stroke-width'],
    'polyline': ['points', 'fill', 'stroke', 'stroke-width'],
    'rect': ['x', 'y', 'width', 'height', 'fill', 'stroke', 'stroke-width'],
    'ellipse': ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width'],
    'text': ['x', 'y', 'font-size', 'text-anchor'],
    'g': ['transform'],
    '*': ['class'],
}

# `mailto` alongside the two real web protocols — no `javascript:`/`data:`/anything else. bleach
# strips (not escapes) an `href`/`src` whose scheme isn't in this list, same `strip=True` behavior
# it applies to a disallowed tag.
ALLOWED_PROTOCOLS = ['http', 'https', 'mailto']

# A real, found-before-shipping bug, caught by verifying against the real corpus before trusting
# this (not assumed correct from reading the allowlist) — the exact same "protect math segments
# before any HTML-aware processing touches them" lesson frontend/src/lib/utils/renderContent.ts's
# own doc comment already learned the hard way, needed here for an unrelated reason: bleach parses
# input through a real HTML5 parser, which normalizes any bare `<`/`>` it doesn't recognize as a
# real tag into `&lt;`/`&gt;` entities — and this math-heavy corpus's own literal LaTeX delimiters
# (`\( … \)`/`\[ … \]`, Section 11) are FULL of bare `<`/`>` as genuine inequality operators (e.g.
# `\(p<\infty\)`), which a first, unguarded version of this function silently corrupted into
# `\(p&lt;\infty\)` — confirmed by diffing sanitize_content's output against every real SVG/math-
# bearing row in the corpus, not assumed safe. Stashing each delimited math segment behind an inert,
# purely-alphanumeric placeholder before bleach ever sees it — then splicing the ORIGINAL text back
# in unchanged afterward — sidesteps the question entirely, the same fix renderContent.ts already
# applies for its own, different (CommonMark escaping) reason.
_DISPLAY_MATH = re.compile(r'\\\[.*?\\\]', re.DOTALL)
_INLINE_MATH = re.compile(r'\\\(.*?\\\)', re.DOTALL)
_PLACEHOLDER = 'EDMATSANITIZEPLACEHOLDERx{}xEND'
_PLACEHOLDER_RE = re.compile(r'EDMATSANITIZEPLACEHOLDERx(\d+)xEND')


def sanitize_content(value: str | None) -> str:
    """The one place every translatable rich-text field gets cleaned — called from
    ExerciseTranslation.save()/MaterialTranslation.save() (models.py, both apps), never from an
    individual view/serializer, so every write path (submission approval, a direct translation
    submission, an applied edit suggestion, the legacy-corpus importer, the Django admin) is
    covered automatically, including any future one nobody remembers to update by hand."""
    if not value:
        return value or ''

    segments: list[str] = []

    def stash(m: re.Match) -> str:
        token = _PLACEHOLDER.format(len(segments))
        segments.append(m.group(0))
        return token

    protected = _DISPLAY_MATH.sub(stash, value)
    protected = _INLINE_MATH.sub(stash, protected)

    cleaned = bleach.clean(
        protected,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
    )

    return _PLACEHOLDER_RE.sub(lambda m: segments[int(m.group(1))], cleaned)
