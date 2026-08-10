"""Chapter -> Lesson -> CourseItem: give a course a real middle level.

Lesson used to sit beside Chapter rather than inside it, and the two were near-duplicates — both
hung off the course with a title, a description and an order, and both grouped content. They
differed only in how: Lesson held two direct M2Ms to exercises and materials, Chapter grouped
`CourseItem` rows, which also carry a review status and a submitter. Only the Chapter half was ever
rendered.

So Lesson becomes the subchapter, its M2Ms go, and `CourseItem` files into a lesson instead of a
chapter. Content stays in CourseItem throughout, because that is the half that can express "a
participant offered this and it is waiting for review".

Hand-written. `makemigrations` wants a one-off default for the new non-null `Lesson.chapter` and
asks for it interactively; the honest answer was "there is nothing to default, because every table
in this app is empty — the feature has never been used". **That assumption was true of every dev
database and false of the one real deployment**: rehearsing this migration against the rescued
webek4/edmat.net database (2026-08-10) hit `NOT NULL constraint failed: courses_lesson.chapter_id`
— that server has a real course ("Licencjat FUW", running) with a real lesson ("Fizyka 2") and no
chapters, created back when Lesson sat directly on the course. So the tightening now has a data
step in front of it: each orphan lesson is promoted into a chapter of its own (same title,
description and order — it WAS a top-level unit of its course under the old shape) and nested
inside it. A no-op on empty tables, so a fresh database behaves exactly as before, and
environments that already applied this migration are untouched (an applied migration never
re-runs).

`RemoveField(lesson, course)` moved below the data step for the same reason — the step needs
`lesson.course_id` to know which course the promoted chapter belongs to.

The two RemoveField ops on the old lesson→exercises/materials M2Ms still run first and still
discard whatever they hold. That stays deliberate: those attachments were API-only, never rendered
anywhere (`CourseItem` was the half every page reads), and the rescued webek4 database was
confirmed to hold zero rows in either table before this was left as-is.
"""

import django.db.models.deletion
from django.db import migrations, models


def _adopt_orphan_lessons(apps, schema_editor):
    """Give every chapterless lesson a chapter of its own, carrying the lesson's identity."""
    Chapter = apps.get_model('courses', 'Chapter')
    Lesson = apps.get_model('courses', 'Lesson')
    for lesson in Lesson.objects.filter(chapter__isnull=True):
        chapter = Chapter.objects.create(
            course_id=lesson.course_id,
            title=lesson.title,
            description=lesson.description,
            order=lesson.order,
        )
        lesson.chapter_id = chapter.pk
        lesson.save(update_fields=['chapter'])


class Migration(migrations.Migration):

    dependencies = [
        ('courses', '0008_alter_course_field_alter_course_instructor_and_more'),
    ]

    operations = [
        # --- content leaves Lesson's own columns ---------------------------------------------
        migrations.RemoveField(model_name='lesson', name='exercises'),
        migrations.RemoveField(model_name='lesson', name='materials'),
        # --- an item files into a lesson, not a chapter --------------------------------------
        migrations.RemoveField(model_name='courseitem', name='chapter'),
        migrations.AddField(
            model_name='courseitem',
            name='lesson',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='items',
                to='courses.lesson',
            ),
        ),
        # --- and a lesson moves under a chapter ------------------------------------------------
        migrations.AddField(
            model_name='lesson',
            name='chapter',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='lessons',
                to='courses.chapter',
            ),
        ),
        migrations.RunPython(_adopt_orphan_lessons, migrations.RunPython.noop),
        migrations.RemoveField(model_name='lesson', name='course'),
        migrations.AlterField(
            model_name='lesson',
            name='chapter',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='lessons',
                to='courses.chapter',
            ),
        ),
    ]
