"""What carries a licence of its own — the registry half of this app's polymorphic history table
(root CLAUDE.md, "A polymorphic target is a `GenericForeignKey` plus a registry").

Four kinds, and the reasoning per model lives in `licensing/CLAUDE.md`. In short: an exercise, a
material, a concept article and a hint/solution are each a work with a nameable author who chose
the licence. A translation is a DERIVATIVE of its exercise and carries the parent's licence at the
moment it was written (`ExerciseTranslation.licence`, set by the model, never chosen). A material
version and a concept revision are contributions INTO a work whose licence is already set, the
Wikipedia shape: the editor contributes under the licence the page shows.

Each entry answers four questions the rules ask:

- `authors(obj)` — who may change the licence as its author (a set of user ids);
- `contributors(obj)` — everybody whose writing is in the current work; a change needs all of
  them to be the person asking, because one co-author cannot relicense another's sentences;
- `visible(obj)` — whether a stranger may read it at all (404 otherwise, house rule 4);
- `created_at(obj)` — when its first licence was granted.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from django.contrib.contenttypes.models import ContentType


def _ids(*users) -> set[int]:
    return {u for u in users if u is not None}


def _exercise():
    from exercises.models import Exercise

    return Kind(
        model=Exercise,
        authors=lambda e: _ids(e.submitted_by_id),
        contributors=lambda e: _ids(e.submitted_by_id),
        visible=lambda e: e.published,
        created_at=lambda e: e.created_at,
    )


def _solution_entry():
    from exercises.models import SolutionEntry

    return Kind(
        model=SolutionEntry,
        authors=lambda s: _ids(s.author_id),
        contributors=lambda s: _ids(s.author_id),
        visible=lambda s: s.is_visible_to_readers() and s.exercise.published,
        created_at=lambda s: s.created_at,
    )


def _material_authors(material) -> set[int]:
    ids = _ids(material.submitted_by_id)
    project = _project_of(material)
    if project is not None:
        ids |= set(project.members.filter(role='owner').values_list('user_id', flat=True))
    return ids


def _project_of(material):
    from coauthoring.models import MaterialProject

    return MaterialProject.objects.filter(material=material).first()


def _material_contributors(material) -> set[int]:
    ids = _ids(material.submitted_by_id)
    project = _project_of(material)
    if project is None:
        return ids
    ids |= {
        uid
        for uid in project.versions.filter(status__in=['published', 'superseded']).values_list(
            'created_by_id', flat=True
        )
        if uid is not None
    }
    return ids


def _material():
    from materials.models import Material

    return Kind(
        model=Material,
        authors=_material_authors,
        contributors=_material_contributors,
        visible=lambda m: m.published,
        created_at=lambda m: m.created_at,
    )


def _concept_article():
    from concepts.models import ConceptArticle

    def contributors(a) -> set[int]:
        ids = _ids(a.created_by_id)
        ids |= {
            uid
            for uid in a.revisions.filter(status__in=['published', 'superseded']).values_list(
                'created_by_id', flat=True
            )
            if uid is not None
        }
        return ids

    return Kind(
        model=ConceptArticle,
        authors=lambda a: _ids(a.created_by_id),
        contributors=contributors,
        visible=lambda a: a.is_visible_to_readers(),
        created_at=lambda a: a.created_at,
    )


@dataclass(frozen=True)
class Kind:
    model: type
    authors: Callable
    contributors: Callable
    visible: Callable
    created_at: Callable


_BUILDERS = {
    'exercise': _exercise,
    'solution_entry': _solution_entry,
    'material': _material,
    'concept_article': _concept_article,
}
LICENSED_KINDS = list(_BUILDERS)


def kind_for(name: str) -> Kind | None:
    builder = _BUILDERS.get(name)
    return builder() if builder else None


def kind_name_of(obj) -> str:
    for name in _BUILDERS:
        if isinstance(obj, kind_for(name).model):
            return name
    return ''


def content_type_of(obj) -> ContentType:
    return ContentType.objects.get_for_model(type(obj))
