"""Give a material that has no project one — the live-model half of migration `0002`.

The migration alone is not enough, and a clean clone is where that shows. `setup.sh` runs
`migrate` (whose `0002_backfill_projects` finds an empty database and does nothing) and only THEN
`import_legacy_corpus`, so every corpus material would be created after the only code that gives a
material a project had already run. The result is a material page with no version history, no
"Improve this material" and no team — the whole feature silently absent on exactly the install
somebody is seeing for the first time. An applied migration never runs again, so this cannot be
fixed by migrating harder; it has to be something the importer calls.

Hence one function and one management command. Same rules as the migration, and for the same
reasons (its docstring argues them in full):

* the version COPIES the material's stored file name — never a re-upload, or the corpus would be
  duplicated on disk;
* `published_at` is the material's own `created_at`, not now, so nothing looks freshly published
  and no translation is marked stale the moment this runs;
* no activity rows and no notifications: nothing happened, these materials have been public for
  months (house rule 9);
* a material with no `submitted_by` gets NO owner row — an orphan project, which is the honest
  state for work nobody on this platform has claimed, and which sends its proposals to staff;
* idempotent: a material that already has a project is skipped, so running it twice is safe and
  running it after a partial import finishes the job.
"""

from __future__ import annotations

from .models import MaterialProject, MaterialVersion, ProjectMember


def _kind_of(material) -> str:
    if material.file:
        return 'file'
    if material.url:
        return 'link'
    return 'body'


def ensure_projects(materials=None) -> int:
    """Create the missing projects. Returns how many were made.

    `materials` is any iterable of `Material` rows (default: all of them). Pass the ones you just
    imported when you know which they are; the query is cheap either way, because it asks for the
    rows that have no project rather than filtering in Python.
    """
    from materials.models import Material, MaterialTranslation

    queryset = Material.objects.filter(project__isnull=True)
    if materials is not None:
        queryset = queryset.filter(pk__in=[m.pk for m in materials])
    rows = list(queryset.select_related('branch'))
    if not rows:
        return 0

    first_translation: dict[int, object] = {}
    for translation in MaterialTranslation.objects.filter(
        material_id__in=[m.pk for m in rows]
    ).order_by('pk'):
        first_translation.setdefault(translation.material_id, translation)

    made = 0
    for material in rows:
        translation = first_translation.get(material.pk)
        project = MaterialProject.objects.create(
            material=material,
            branch=material.branch,
            locale=translation.locale if translation is not None else 'pl',
            type=material.type,
            audience=material.audience,
            author=material.author,
            source_url=material.source_url,
            price_amount=material.price_amount,
            price_currency=material.price_currency or 'PLN',
            estimated_minutes=material.estimated_minutes,
            created_by_id=material.submitted_by_id,
        )
        # `MaterialProject.save()` seats the creator as owner already; this is here for the case it
        # cannot cover — `created_by` null (a corpus material nobody submitted) leaves no owner, and
        # that is deliberate, not a gap. `get_or_create` because the save above may have made it.
        if material.submitted_by_id:
            ProjectMember.objects.get_or_create(
                project=project,
                user_id=material.submitted_by_id,
                defaults={'role': 'owner'},
            )
        MaterialVersion.objects.create(
            project=project,
            number=1,
            status='published',
            kind=_kind_of(material),
            file=material.file.name if material.file else '',
            url=material.url or '',
            body=material.body or '',
            title=(translation.title if translation is not None else '') or material.slug,
            description=(translation.description if translation is not None else ''),
            created_by_id=material.submitted_by_id,
            published_at=material.created_at,
        )
        made += 1
    return made
