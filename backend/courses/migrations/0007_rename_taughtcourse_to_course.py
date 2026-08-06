"""TaughtCourse -> Course, now that the taxonomy has released the name.

The app label changed too (`classroom` -> `courses`), which Django has no migration operation for:
a label is not state, it is where the state is read from. The consequences are all in the database
rather than in this file, and are handled by 0008.
"""

from django.db import migrations


class Migration(migrations.Migration):

    # Both of these name `courses.taughtcourse` — one as an FK target, one via `get_model` — and
    # the graph is free to schedule them after this rename unless told otherwise, at which point
    # they resolve a model that no longer has that name. Same lesson as `taxonomy.0003`: the
    # migration graph only orders what it is told to order.
    dependencies = [
        ('courses', '0006_split_visibility_from_status'),
        ('notifications', '0003_notification_taught_course_alter_notification_type'),
        ('taxonomy', '0005_merge_branches_drop_university_slugs'),
    ]

    operations = [
        migrations.RenameModel(old_name='TaughtCourse', new_name='Course'),
    ]
