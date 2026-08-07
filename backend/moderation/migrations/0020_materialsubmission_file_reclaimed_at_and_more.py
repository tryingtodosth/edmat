"""Records what a rejection reclaimed — see `_reclaim_rejected_material_file` (moderation/views.py)
for why a rejected submission now loses its stored blob while keeping its row and every other field.

Both columns are correct for existing rows without any backfill, and correct for an honest reason
rather than a convenient one: nothing in this codebase has ever deleted a `MaterialSubmission.file`,
so `file_reclaimed_at = NULL` ("nothing was reclaimed from this one") and `reclaimed_file_bytes = 0`
are true of every row that predates this migration, including the already-rejected ones — their
files really are still on disk. They are reclaimed if and when somebody rejects them, which for a
row already rejected means never; a one-off sweep of historical rejections is a real, separate
decision (it destroys bytes nobody has been asked about) and is deliberately not smuggled in here.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('moderation', '0019_alter_featureflag_key'),
    ]

    operations = [
        migrations.AddField(
            model_name='materialsubmission',
            name='file_reclaimed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='materialsubmission',
            name='reclaimed_file_bytes',
            field=models.PositiveBigIntegerField(default=0),
        ),
    ]
