"""Give every existing course an owner row.

`TaughtCourse.role_of` answers from `CourseStaff` alone, with no fallback to the `instructor` field —
that fallback is exactly the special case the staff table exists to remove. So every course that
already existed needs its owner row, or its own creator would find themselves locked out of the
course they made the moment this ships.

Reversible on purpose, and the reverse deletes only owner rows: an admin or assistant added after
this migration ran is real data somebody chose, not something to throw away on a rollback.
"""

from django.db import migrations


def create_owner_rows(apps, schema_editor):
    TaughtCourse = apps.get_model('courses', 'TaughtCourse')
    CourseStaff = apps.get_model('courses', 'CourseStaff')

    existing = set(
        CourseStaff.objects.filter(role='owner').values_list('course_id', flat=True)
    )
    CourseStaff.objects.bulk_create(
        [
            # `added_by` stays null: nobody added the owner, and naming whoever happened to run the
            # migration would be a fabricated audit trail.
            CourseStaff(course_id=course.pk, user_id=course.instructor_id, role='owner')
            for course in TaughtCourse.objects.all()
            if course.pk not in existing
        ]
    )


def delete_owner_rows(apps, schema_editor):
    CourseStaff = apps.get_model('courses', 'CourseStaff')
    CourseStaff.objects.filter(role='owner').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('courses', '0003_taughtcourse_contribution_policy_chapter_and_more'),
    ]

    operations = [
        migrations.RunPython(create_owner_rows, delete_owner_rows),
    ]
