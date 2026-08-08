"""Point `Attachment.file` at its own validator instead of the bare material one.

No SQL: a `FileField`'s `validators` are enforced in Python, so this alters the historical model state
and touches no column. It exists because Django tracks validators as part of the field, and leaving it
ungenerated would make `makemigrations --check` fail for every later change.

The new validator wraps the old one rather than replacing it — a PDF or a `.docx` is checked exactly as
before. What it adds is the decoded-pixel budget for an image, which the material validator cannot
apply because it never decodes anything. See `courses/attachmentfile.py`.

Existing rows are untouched, deliberately. Their files were stored before any of this existed and may
still carry the EXIF this change is about; rewriting bytes on disk is not something a migration can
roll back, so it is `strip_attachment_image_metadata`'s job instead — a command that can be dry-run
first and re-run safely.
"""

import courses.attachmentfile
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('courses', '0015_course_progress_visibility_lessonprogress'),
    ]

    operations = [
        migrations.AlterField(
            model_name='attachment',
            name='file',
            field=models.FileField(upload_to='course-attachments/', validators=[courses.attachmentfile.validate_attachment_file]),
        ),
    ]
