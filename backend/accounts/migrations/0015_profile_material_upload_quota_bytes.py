"""Adds the per-account material-upload allowance, defaulting to 0 — which this codebase reads as
"no limit" (`TaughtCourse.capacity`, `TaughtCourse.upload_quota_bytes` and `Profile.max_courses` all
use the same convention).

So every existing account keeps behaving exactly as it did before this column existed, and nothing
changes for anybody until an administrator deliberately types a number into Django admin. That is
the same discipline moderation/0011 states for the `material_uploads_verified_only` flag it seeds
OFF: provisioning a limit must never quietly narrow somebody's access on the strength of merely
existing, and the reputation ladder that would one day set these numbers automatically (/levels) is
still designed rather than built.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0014_rename_course_skillentry_branch_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='material_upload_quota_bytes',
            field=models.PositiveBigIntegerField(default=0),
        ),
    ]
