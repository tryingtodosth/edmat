"""Give every material that already exists a project and a version 1.

**Why every material and not just new ones.** The whole design rests on `Material` being the
published projection of a version: the panel on a material page says "version N, published on X by
Y", the "Improve this material" button proposes against the published version, and the stale
translation marker compares against `published_version.published_at`. A material with no project
would have none of that — not a degraded version of it, an absent one — and every read site would
need a branch for "…unless it predates co-authoring". One backfill removes that branch permanently.

**What a backfilled project deliberately does NOT do.**

* **No activity rows.** `record_activity` is only ever called for something that was public at that
  instant (house rule 9, `activity/models.py`), and a backfilled v1 announces nothing: the material
  it describes has been public for months. A migration that filled the feed with hundreds of
  "new version" rows dated today would be the exact failure the feed's own contract forbids.
* **No notifications.** Same reasoning one layer down: nobody did anything, so nobody is told.
* **Never re-uploads a file.** `version.file` is assigned the material's stored NAME, which copies
  the reference to the path the bytes are already at — the same thing `Material.file = submission
  .file` has always done on approval. Re-saving would duplicate every PDF in the corpus on disk and
  leave two paths to the same document.
* **No owner for a material with no `submitted_by`.** Every one of the migrated corpus materials
  has none, and inventing one would attribute somebody's work to whoever ran this. A project with
  no members is exactly what `access.needs_staff_review` calls an orphan, which is the correct
  answer for a material nobody on this platform has ever claimed: proposals on it go to staff.
* **No `requirements`/`coverage` copy.** Those columns on a project are read ONLY while it is still
  a draft (`MaterialProject`'s own docstring); a project with a material reads them off the real,
  votable `MaterialRequirement`/`MaterialCoverage` rows. Copying them here would create a second,
  immediately-stale answer to a question the material already answers correctly.

Reverse is a deliberate no-op rather than a delete. Unapplying this must not destroy the versions,
members and history that real use has added on top of the backfilled rows since — and `forwards`
skips anything that already has a project, so re-applying is safe and idempotent.
"""

from django.db import migrations


def _kind_of(material) -> str:
    """Which of the three shapes this material already is.

    `body` is the fallback for a row with none of the three — which `Material.clean()` forbids but
    a bulk `create()` never ran, so the corpus importer or an old fixture could have left one. An
    honest empty written material is a better outcome than a migration that crashes on it.
    """
    if material.file:
        return 'file'
    if material.url:
        return 'link'
    return 'body'


def backfill(apps, schema_editor):
    Material = apps.get_model('materials', 'Material')
    MaterialTranslation = apps.get_model('materials', 'MaterialTranslation')
    MaterialProject = apps.get_model('coauthoring', 'MaterialProject')
    MaterialVersion = apps.get_model('coauthoring', 'MaterialVersion')
    ProjectMember = apps.get_model('coauthoring', 'ProjectMember')

    # `filter(material__isnull=False)` first, deliberately: a draft project has `material_id`
    # NULL, and a NULL inside an `IN (…)` list makes the whole `NOT IN` evaluate to NULL in SQL —
    # which would silently skip EVERY material rather than none of them.
    already = set(
        MaterialProject.objects.filter(material__isnull=False).values_list('material_id', flat=True)
    )
    materials = list(Material.objects.exclude(pk__in=already))
    if not materials:
        return

    # One query for every translation rather than one per material. The FIRST row by pk is the one
    # taken when a material somehow has several — the original-locale row is the one the corpus
    # importer and `create_material` both write first, and this app has no other way to tell which
    # of two translations is the original.
    first_translation: dict[int, object] = {}
    for row in MaterialTranslation.objects.filter(
        material_id__in=[m.pk for m in materials]
    ).order_by('pk'):
        first_translation.setdefault(row.material_id, row)

    for material in materials:
        translation = first_translation.get(material.pk)
        project = MaterialProject.objects.create(
            material=material,
            branch_id=material.branch_id,
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
        if material.submitted_by_id:
            # `MaterialProject.save()` would normally seat the creator as owner, but a historical
            # model has the plain `Model.save`, so the row is created explicitly here. `added_by`
            # stays null: nobody added them, and naming whoever ran this migration would be false.
            ProjectMember.objects.create(
                project=project, user_id=material.submitted_by_id, role='owner'
            )
        MaterialVersion.objects.create(
            project=project,
            number=1,
            status='published',
            kind=_kind_of(material),
            # The SAME stored path, assigned as a name — never a re-upload. See the module docstring.
            file=material.file.name if material.file else '',
            url=material.url or '',
            body=material.body or '',
            title=(translation.title if translation is not None else '') or material.slug,
            description=(translation.description if translation is not None else ''),
            created_by_id=material.submitted_by_id,
            # The material's own creation time, not now: this version IS what was published then,
            # and a `published_at` of today would make every existing translation look stale the
            # moment this ran (`MaterialSerializer.translation_stale` compares against exactly this).
            published_at=material.created_at,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('coauthoring', '0001_initial'),
        ('materials', '0018_material_body_translation_updated_at'),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
