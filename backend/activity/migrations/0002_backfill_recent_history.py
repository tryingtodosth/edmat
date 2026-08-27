# Seeds the feed from what already happened — a stored log starts empty, and an empty Activity
# page on day one would read as a dead product. Backfilled: the CONTENT kinds only (authored
# exercises/materials/solution entries, non-draft courses, public events, active listings), newest
# 100 per kind within the retention window — community actions (comments/reviews/claims) start
# accruing from the feature's own go-live instead, since reconstructing their per-target publicness
# historically is exactly the after-the-fact filtering the public-by-construction rule exists to
# avoid. Rows are inserted in chronological order (the feed sorts by -id) and their `created_at`
# is then set to the real original timestamp (auto_now_add stamps insertion time otherwise).

from datetime import timedelta

from django.db import migrations
from django.utils import timezone


def forwards(apps, schema_editor):
    ActivityEvent = apps.get_model('activity', 'ActivityEvent')
    Exercise = apps.get_model('exercises', 'Exercise')
    ExerciseTranslation = apps.get_model('exercises', 'ExerciseTranslation')
    SolutionEntry = apps.get_model('exercises', 'SolutionEntry')
    Material = apps.get_model('materials', 'Material')
    MaterialTranslation = apps.get_model('materials', 'MaterialTranslation')
    Course = apps.get_model('courses', 'Course')
    Event = apps.get_model('events', 'Event')
    Service = apps.get_model('services', 'Service')

    cutoff = timezone.now() - timedelta(days=90)
    rows = []

    def title_of(translations, fallback=''):
        by_locale = {t.locale: t for t in translations}
        t = by_locale.get('pl') or next(iter(by_locale.values()), None)
        return t.title if t else fallback

    exercise_titles = {}
    for t in ExerciseTranslation.objects.filter(status='published'):
        exercise_titles.setdefault(t.exercise_id, []).append(t)
    material_titles = {}
    for t in MaterialTranslation.objects.all():
        material_titles.setdefault(t.material_id, []).append(t)

    for ex in (
        Exercise.objects.filter(
            published=True, submitted_by__isnull=False, created_at__gte=cutoff
        )
        .select_related('branch__discipline')
        .order_by('-created_at')[:100]
    ):
        rows.append(
            dict(
                kind='exercise',
                actor_id=ex.submitted_by_id,
                target_label=title_of(exercise_titles.get(ex.pk, []), f'#{ex.number}')[:300],
                exercise_id=ex.pk,
                branch_id=ex.branch_id,
                discipline_id=ex.branch.discipline_id,
                created_at=ex.created_at,
            )
        )

    for entry in (
        SolutionEntry.objects.filter(
            status='published', is_removed=False, auto_hidden_at__isnull=True,
            author__isnull=False, exercise__published=True, created_at__gte=cutoff,
        )
        .select_related('exercise__branch__discipline')
        .order_by('-created_at')[:100]
    ):
        rows.append(
            dict(
                kind='solution_entry',
                entry_kind=entry.kind,
                actor_id=entry.author_id,
                target_label=title_of(
                    exercise_titles.get(entry.exercise_id, []), f'#{entry.exercise.number}'
                )[:300],
                exercise_id=entry.exercise_id,
                branch_id=entry.exercise.branch_id,
                discipline_id=entry.exercise.branch.discipline_id,
                created_at=entry.created_at,
            )
        )

    for material in (
        Material.objects.filter(
            published=True, submitted_by__isnull=False, created_at__gte=cutoff
        )
        .select_related('branch__discipline')
        .order_by('-created_at')[:100]
    ):
        rows.append(
            dict(
                kind='material',
                actor_id=material.submitted_by_id,
                target_label=title_of(material_titles.get(material.pk, []), material.slug)[:300],
                material_id=material.pk,
                branch_id=material.branch_id,
                discipline_id=material.branch.discipline_id,
                created_at=material.created_at,
            )
        )

    for course in Course.objects.exclude(status='draft').filter(
        created_at__gte=cutoff
    ).order_by('-created_at')[:100]:
        rows.append(
            dict(
                kind='course',
                actor_id=course.instructor_id,
                target_label=course.title[:300],
                course_id=course.pk,
                created_at=course.created_at,
            )
        )

    for event in Event.objects.filter(
        status='published', visibility='public', created_at__gte=cutoff
    ).order_by('-created_at')[:100]:
        rows.append(
            dict(
                kind='event',
                actor_id=event.host_id,
                target_label=event.title[:300],
                happening_id=event.pk,
                created_at=event.created_at,
            )
        )

    for service in Service.objects.filter(is_active=True, created_at__gte=cutoff).order_by(
        '-created_at'
    )[:100]:
        rows.append(
            dict(
                kind='service',
                actor_id=service.provider_id,
                target_label=service.title[:300],
                service_id=service.pk,
                created_at=service.created_at,
            )
        )

    rows.sort(key=lambda r: r['created_at'])
    for row in rows:
        original = row.pop('created_at')
        event_row = ActivityEvent.objects.create(**row)
        ActivityEvent.objects.filter(pk=event_row.pk).update(created_at=original)


def backwards(apps, schema_editor):
    apps.get_model('activity', 'ActivityEvent').objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ('activity', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
