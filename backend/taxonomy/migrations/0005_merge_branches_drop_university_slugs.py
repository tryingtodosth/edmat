"""Collapse the four university-specific przedmiot rows into two real branches.

    uw-matematyka-am2   ─┐
    uw-fizyka-analiza1   ├─→ analiza-matematyczna
    uw-informatyka-am1  ─┘
    uw-matematyka-rp1    ──→ rachunek-prawdopodobienstwa

The three analysis rows were three universities' three courses about one subject, which is precisely
the distinction the old model could not draw. `Analiza I` for physicists and `Analiza Matematyczna
II` for mathematicians are the same branch at different depths, and that depth is a property of the
class that teaches it, not of the mathematics.

**Nothing is deleted except the emptied branch rows themselves.** The obvious implementation —
delete the two small rows, since nobody cares about three physics exercises — is wrong: those four
exercises carry 2 reviews, a place in somebody's saved exercise set, 8 recorded views and 5
translations, and `Exercise.branch` cascades. Merging keeps all of it.

**Exercise numbers are rewritten on the way in.** `Exercise` is unique on `(branch, number)` and
every incoming number collided: the stubs number from 1 and the target already runs 1–384. Each
moved exercise is renumbered to the end of the target's range instead, which is a visible change (an
exercise's identity string is `{branch.slug}-{number:04d}`) but loses nothing.

Written to survive a database this was never run against — the deployed instance may hold materials,
tutoring listings or governor grants on rows that are empty locally. Every relation into Branch is
re-pointed, and both collision-prone unique constraints, `(branch, number)` on Exercise and
`(branch, slug)` on Material, are resolved rather than assumed away. A branch that is not present is
skipped, so this is safe on a fresh database too.
"""

from django.db import migrations

MERGES = [
    # (surviving slug, its new slug, [slugs merged into it])
    ('uw-matematyka-am2', 'analiza-matematyczna', ['uw-fizyka-analiza1', 'uw-informatyka-am1']),
    ('uw-matematyka-rp1', 'rachunek-prawdopodobienstwa', []),
]


def merge(apps, schema_editor):
    Branch = apps.get_model('taxonomy', 'Branch')
    Topic = apps.get_model('taxonomy', 'Topic')
    Chapter = apps.get_model('taxonomy', 'Chapter')
    Exercise = apps.get_model('exercises', 'Exercise')
    Material = apps.get_model('materials', 'Material')
    ExerciseSubmission = apps.get_model('moderation', 'ExerciseSubmission')
    MaterialSubmission = apps.get_model('moderation', 'MaterialSubmission')
    SkillEntry = apps.get_model('accounts', 'SkillEntry')
    Service = apps.get_model('services', 'Service')
    Event = apps.get_model('events', 'Event')
    TaughtCourse = apps.get_model('classroom', 'TaughtCourse')
    CourseGrade = apps.get_model('identity', 'CourseGrade')

    for keep_slug, new_slug, absorb_slugs in MERGES:
        target = Branch.objects.filter(slug=keep_slug).first()
        if target is None:
            continue

        for slug in absorb_slugs:
            source = Branch.objects.filter(slug=slug).first()
            if source is None or source.pk == target.pk:
                continue

            # --- topics: move, or fold onto the target's own same-slug topic -------------------
            # `(branch, slug)` is unique. Locally these sets are disjoint (the stubs use coarse
            # slugs like `calki`, the target specific ones like `calki-z-form-po-krzywych`), but a
            # collision elsewhere must not abort the migration.
            for topic in Topic.objects.filter(branch=source):
                twin = Topic.objects.filter(branch=target, slug=topic.slug).first()
                if twin is None:
                    topic.branch = target
                    topic.save(update_fields=['branch'])
                else:
                    # Hand the duplicate's content to the survivor, then drop the empty row.
                    for exercise in topic.exercises.all():
                        exercise.topics.add(twin)
                        exercise.topics.remove(topic)
                    for chapter in topic.chapters.all():
                        chapter.topics.add(twin)
                        chapter.topics.remove(topic)
                    topic.delete()

            # --- exercises: renumber past the end of the target's range ------------------------
            last = (
                Exercise.objects.filter(branch=target).order_by('-number').first()
            )
            next_number = (last.number if last else 0) + 1
            for exercise in Exercise.objects.filter(branch=source).order_by('number'):
                exercise.branch = target
                exercise.number = next_number
                exercise.save(update_fields=['branch', 'number'])
                next_number += 1

            # --- materials: unique on (branch, slug), so suffix a clashing slug ----------------
            for material in Material.objects.filter(branch=source):
                slug_now = material.slug
                if Material.objects.filter(branch=target, slug=slug_now).exists():
                    slug_now = f'{material.slug}-{slug}'[:50]
                material.branch = target
                material.slug = slug_now
                material.save(update_fields=['branch', 'slug'])

            # --- chapters: unique on (branch, number), so renumber past the end ---------------
            last_chapter = Chapter.objects.filter(branch=target).order_by('-number').first()
            next_chapter = (last_chapter.number if last_chapter else 0) + 1
            for chapter in Chapter.objects.filter(branch=source).order_by('number'):
                chapter.number = next_chapter
                chapter.branch = target
                chapter.save(update_fields=['branch', 'number'])
                next_chapter += 1

            # --- everything else pointing at the source ---------------------------------------
            ExerciseSubmission.objects.filter(branch=source).update(branch=target)
            MaterialSubmission.objects.filter(branch=source).update(branch=target)
            SkillEntry.objects.filter(branch=source).update(branch=target)
            CourseGrade.objects.filter(matched_course=source).update(matched_course=target)

            for service in Service.objects.filter(branches=source):
                service.branches.remove(source)
                service.branches.add(target)
            for event in Event.objects.filter(subjects=source):
                event.subjects.remove(source)
                event.subjects.add(target)
            for taught in TaughtCourse.objects.filter(subjects=source):
                taught.subjects.remove(source)
                taught.subjects.add(target)

            # Its translations go with it; nothing else points here now.
            source.delete()

        target.slug = new_slug
        target.save(update_fields=['slug'])


def unmerge(apps, schema_editor):
    """Deliberately not reversible.

    Splitting `analiza-matematyczna` back into three would mean knowing which exercise came from
    which university, and the renumbering has already discarded that. Restore from a backup instead
    — which `deploy/DEPLOYMENT.md` requires taking before any migration anyway.
    """
    raise NotImplementedError(
        'taxonomy.0005 cannot be reversed — restore the pre-migration database backup instead.'
    )


class Migration(migrations.Migration):

    dependencies = [
        ('taxonomy', '0004_branch_drop_university'),
        ('accounts', '0014_rename_course_skillentry_branch_and_more'),
        ('classroom', '0001_initial'),
        ('events', '0002_rename_field_event_discipline'),
        ('exercises', '0007_alter_exercise_options_rename_course_exercise_branch_and_more'),
        ('identity', '0001_initial'),
        ('materials', '0011_alter_material_options_rename_course_material_branch_and_more'),
        ('moderation', '0017_rename_course_exercisesubmission_branch_and_more'),
        ('services', '0006_rename_courses_service_branches'),
    ]

    operations = [
        migrations.RunPython(merge, unmerge),
    ]
