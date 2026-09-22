"""Drop `MaterialSubmission`. Its rows are already projects and versions.

Deliberately its own migration, after `coauthoring/0003_fold_material_submissions` and depending on
it, so the order can never be the other way round: a `DeleteModel` that ran first would take the
history with it and leave the fold with nothing to read. Django's dependency graph is what enforces
that, rather than the two happening to be numbered in a convenient order.

**The files stay.** Deleting a table does not touch storage, and that is correct here: a folded
version holds the very same `material_submissions/<uuid>.<ext>` name the submission did, and an
approved one's `Material` has held it since approval. The blobs are reachable, accounted for by
`Profile.material_upload_bytes`, and reclaimed by the ordinary rule when a version is rejected or
withdrawn.

Reversing this recreates an empty table, which is honest — the rows are somewhere else now, and the
fold's own reverse is a no-op for the same reason. What actually goes back is the schema.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('moderation', '0037_seed_coauthoring_flag'),
        ('coauthoring', '0003_fold_material_submissions'),
    ]

    operations = [
        migrations.DeleteModel(name='MaterialSubmission'),
    ]
