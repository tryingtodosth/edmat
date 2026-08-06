"""Re-label the `classroom` app as `courses` in a database that predates the rename.

**This has to run before `migrate`, and `migrate` will refuse to start until it has.**

Renaming a Django app is not something a migration can do. A migration describes a change to the
schema; an app label is the name the schema is filed under, and `django_migrations` records it on
every applied row. So a database that applied `classroom.0001_initial` still says `classroom`, while
the code now says `courses` — and `migrate` fails its own consistency check before running a single
operation:

    InconsistentMigrationHistory: Migration notifications.0003_... is applied before its
    dependency courses.0002_... on database 'default'

That is not a warning to work around. It is Django noticing that half its bookkeeping refers to an
app it can no longer find, and it is correct to stop.

So this command does the three things a migration cannot, all of them idempotent, in one
transaction:

  * renames every `classroom_*` table to its `courses_*` name
  * rewrites `django_migrations.app` from 'classroom' to 'courses'
  * rewrites `django_content_type.app_label` the same way, so generic foreign keys, admin
    permissions and `ContentType.objects.get_for_model` keep resolving

Afterwards `migrate` runs normally, and `courses.0007` renames TaughtCourse to Course from there.

Safe to run twice, and safe to run on a database that never had the old app — it finds nothing and
says so. That matters because `setup.sh` and a fresh checkout both reach it.
"""

from django.core.management.base import BaseCommand
from django.db import connection, transaction

#: old table name -> new table name. This changes the app prefix ONLY. `taughtcourse` keeps its
#: name here and becomes `course` in `courses.0007`, which is a real migration and should own the
#: model rename — this command's job is strictly to make the database findable under the new label.
TABLE_RENAMES = {
    'classroom_taughtcourse': 'courses_taughtcourse',
    'classroom_taughtcourse_subjects': 'courses_taughtcourse_subjects',
    'classroom_lesson': 'courses_lesson',
    'classroom_lesson_exercises': 'courses_lesson_exercises',
    'classroom_lesson_materials': 'courses_lesson_materials',
    'classroom_enrollment': 'courses_enrollment',
    'classroom_chapter': 'courses_chapter',
    'classroom_courseitem': 'courses_courseitem',
    'classroom_coursestaff': 'courses_coursestaff',
    'classroom_courseinvite': 'courses_courseinvite',
}

#: Content types move with the label only. The `taughtcourse` -> `course` model rename is
#: `courses.0007`'s business, and Django updates the content type itself when a RenameModel runs.
MODEL_RENAMES: dict[str, str] = {}


class Command(BaseCommand):
    help = 'Re-label the classroom app as courses. Run once, before migrate.'

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            existing = set(connection.introspection.table_names(cursor))

            renamed = 0
            with transaction.atomic():
                for old, new in TABLE_RENAMES.items():
                    if old not in existing:
                        continue
                    if new in existing:
                        # Both names present means a half-finished attempt, or a `migrate` that
                        # already created fresh tables alongside the old ones. Refusing is the only
                        # honest response: picking one would silently discard the other.
                        raise RuntimeError(
                            f'Both "{old}" and "{new}" exist. Restore the backup and re-run this '
                            f'command before any migrate.'
                        )
                    cursor.execute(f'ALTER TABLE "{old}" RENAME TO "{new}"')
                    renamed += 1

                cursor.execute(
                    "UPDATE django_migrations SET app = 'courses' WHERE app = 'classroom'"
                )
                migrations_moved = cursor.rowcount

                for old_model, new_model in MODEL_RENAMES.items():
                    cursor.execute(
                        'UPDATE django_content_type SET model = %s '
                        "WHERE app_label = 'classroom' AND model = %s",
                        [new_model, old_model],
                    )
                cursor.execute(
                    "UPDATE django_content_type SET app_label = 'courses' "
                    "WHERE app_label = 'classroom'"
                )
                content_types_moved = cursor.rowcount

        if not (renamed or migrations_moved or content_types_moved):
            self.stdout.write('Nothing to do — this database has no `classroom` app.')
            return

        self.stdout.write(
            self.style.SUCCESS(
                f'Renamed {renamed} tables, {migrations_moved} migration rows and '
                f'{content_types_moved} content types. You can run migrate now.'
            )
        )
