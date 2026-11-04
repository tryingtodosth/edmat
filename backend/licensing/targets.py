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


def _course():
    """A course's own licence (2026-11-02): it covers what is WRITTEN in the course — the
    description, the chapters and lessons — which is its staff's shared work. The administrators
    are its authors (they may change it); every member of staff is a contributor, because an
    assistant's lesson text is in it, so a change needs nobody else's writing in the course — the
    same rule a co-authored material lives under. Honest limit: lessons do not record who wrote
    them, so the contributors are the staff of TODAY; somebody who wrote week 3 and has since left
    the staff is not asked."""
    from courses.models import ADMINISTERING_ROLES, Course

    def authors(c) -> set[int]:
        return {row.user_id for row in c.staff.all() if row.role in ADMINISTERING_ROLES}

    def visible_to(c, user) -> bool:
        from courses.rules import course_visible_to

        return course_visible_to(user, c)

    return Kind(
        model=Course,
        authors=authors,
        contributors=lambda c: {row.user_id for row in c.staff.all()},
        visible=lambda c: c.visibility == 'public',
        created_at=lambda c: c.created_at,
        visible_to=visible_to,
    )


def _course_attachment():
    """A file uploaded into a course: its uploader chose its licence (starting from the course's),
    and only the uploader may widen it. Never public — readable by whoever is in the room."""
    from courses.models import Attachment

    return Kind(
        model=Attachment,
        authors=lambda a: _ids(a.uploaded_by_id),
        contributors=lambda a: _ids(a.uploaded_by_id),
        visible=lambda a: False,
        created_at=lambda a: a.created_at,
        visible_to=lambda a, user: user is not None and a.is_visible_to(user),
    )


@dataclass(frozen=True)
class Kind:
    model: type
    authors: Callable
    contributors: Callable
    visible: Callable
    created_at: Callable
    #: For a kind whose readers are not "everybody or nobody" (a course, a course's file): who
    #: else may read its licence. None = `visible` alone decides.
    visible_to: Callable | None = None


_BUILDERS = {
    'exercise': _exercise,
    'solution_entry': _solution_entry,
    'material': _material,
    'concept_article': _concept_article,
    'course': _course,
    'course_attachment': _course_attachment,
}
#: The CONTENT kinds — what `/api/licences/mine/`, the bulk change and `relicense_content` walk.
#: A course and a course's file are deliberately not in it (2026-11-02): a course's licence is its
#: staff's decision, made on the course, and a staff sweep has no business relicensing what a
#: group of people wrote together. Listing them on `/settings/licences` is left open.
LICENSED_KINDS = ['exercise', 'solution_entry', 'material', 'concept_article']
#: Every kind `/api/licences/<kind>/<id>/` answers for.
ALL_LICENSED_KINDS = list(_BUILDERS)


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
