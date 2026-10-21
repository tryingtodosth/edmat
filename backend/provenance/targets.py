"""What an "AI-assisted" mark may be attached to — the registry half of this app's polymorphic
target (root CLAUDE.md, "A polymorphic target is a `GenericForeignKey` plus a registry").

Deliberately SHORTER than `moderation/services.py: REPORT_KIND_MODELS`, and the difference is the
point the root CLAUDE.md makes about these registries: everything in this app is a judgement about
**who wrote a piece of prose**, so only things somebody wrote are in it. A tag, a venue or a
taxonomy proposal is reportable and has no prose to have been generated; an exercise's statement,
a hint, a solution, a comment and a review all do, and those five are exactly what the owner named
on 2026-10-08.

The second column is **the field holding the person who wrote it**, which is what
`rules.can_declare` asks before letting somebody make the author's own mark. It is a different name
on three of the four models (`submitted_by` on an Exercise, `author` on the rest) and nullable on
two of them — a migrated corpus exercise and a held anonymous comment both have nobody to ask. A
target with no author simply has no author mark available, which is the honest answer rather than
an error.

Note there is no separate `hint` / `solution` kind: both are `exercises.SolutionEntry` rows that
differ by their own `kind` field, so one entry here covers the tip and the solution the owner's
message names separately. The statement is the Exercise itself, because that is where the corpus
text lives (`ExerciseTranslation` is a per-locale rendering of it, and marking one language of a
statement AI-assisted while the other is not would be a claim nobody made).
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType

from community.models import Comment, Review
from concepts.models import ConceptArticle
from exercises.models import Exercise, SolutionEntry

#: kind -> (model, the name of the field holding its author, or None if it has no single one)
#:
#: `concept_article` (2026-10-21, for `manage.py import_concepts --ai-assisted`) is the ARTICLE, not
#: a revision: it is the unit with one author (`created_by`) and the licensing unit
#: (`licensing/targets.py`), and a reader sees one article's head at a time — a per-revision mark
#: would light or not depending on which version happened to be the head. Its visibility is not
#: the generic `is_removed` / `published` / `status` shape, so `rules.is_readable` asks
#: `concepts.access.can_view_article` for it by name. The concept page draws its chip beside the
#: byline and offers the mark in its "⋯" menu (`types/provenance.ts` lists the kind).
PROVENANCE_KIND_MODELS = {
    'exercise': (Exercise, 'submitted_by'),
    'solution_entry': (SolutionEntry, 'author'),
    'comment': (Comment, 'author'),
    'review': (Review, 'author'),
    'concept_article': (ConceptArticle, 'created_by'),
}

_REVERSE_KIND_MODELS = {model: kind for kind, (model, _field) in PROVENANCE_KIND_MODELS.items()}


def model_for(kind: str):
    """The model behind a kind string, or None — callers 404 on None rather than raising, because a
    kind is user input off a URL."""
    entry = PROVENANCE_KIND_MODELS.get(kind)
    return entry[0] if entry else None


def kind_of(obj) -> str:
    """The kind string for an instance, or `''` for a model this registry has never been taught.

    Empty rather than an exception, for the reason `community/targets.py: target_type_for` gives:
    a row hanging off something added later is a gap in this table, not a corrupt row.
    """
    return _REVERSE_KIND_MODELS.get(type(obj), '')


def author_of(obj):
    """Who wrote this, or None. None is a real answer here and not a failure — the imported corpus
    has no submitter, and a comment held from an anonymous visitor has no account."""
    entry = PROVENANCE_KIND_MODELS.get(kind_of(obj))
    if entry is None:
        return None
    return getattr(obj, entry[1], None)


def content_type_for(kind: str):
    model = model_for(kind)
    return ContentType.objects.get_for_model(model) if model else None
