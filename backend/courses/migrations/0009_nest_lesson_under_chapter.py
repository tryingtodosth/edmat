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
asks for it interactively; the honest answer is that there is nothing to default, because every
table in this app is empty — the feature has never been used. Adding the column nullable and then
tightening it says exactly that, and works the same on a fresh database.
"""

import django.db.models.deletion
from django.db import migrations, models


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
        migrations.RemoveField(model_name='lesson', name='course'),
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
