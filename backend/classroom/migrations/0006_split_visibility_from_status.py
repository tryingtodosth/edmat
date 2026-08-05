"""Carry the old single `status` field across onto the new (visibility, status) pair.

The old field answered two questions at once. `draft` was the answer to "who can see this", and
`open`/`running`/`finished` were answers to "how far along is it" that ALSO implied "public". So:

    draft    -> only_you + open      the course was nobody else's to see, and had not started
    open     -> public   + open
    running  -> public   + running
    finished -> public   + finished

A draft becomes `open` rather than keeping some notion of not-started, because there is no longer a
lifecycle value meaning "not visible" — that is precisely what moved to `visibility`. `only_you`
keeps it invisible, so nothing is published by this migration; the instructor's next publish is a
deliberate act, exactly as it was before.

Nothing maps to `private`. It is a genuinely new option nobody could previously express, and
inventing it for existing rows would hand out links to courses whose owners never chose to share
them.
"""

from django.db import migrations

FORWARD = {
    'draft': ('only_you', 'open'),
    'open': ('public', 'open'),
    'running': ('public', 'running'),
    'finished': ('public', 'finished'),
}


def split(apps, schema_editor):
    TaughtCourse = apps.get_model('classroom', 'TaughtCourse')
    for old_status, (visibility, new_status) in FORWARD.items():
        TaughtCourse.objects.filter(status=old_status).update(
            visibility=visibility, status=new_status
        )


def merge(apps, schema_editor):
    """Fold the pair back into one field.

    Lossy, and unavoidably so: `private` has no pre-split equivalent, so it comes back as a draft —
    invisible to everyone but the course's own staff. That is the safe direction to lose information
    in. Reversing this migration cannot re-publish something to an audience it was never meant for.
    """
    TaughtCourse = apps.get_model('classroom', 'TaughtCourse')
    TaughtCourse.objects.exclude(visibility='public').update(status='draft')


class Migration(migrations.Migration):
    dependencies = [
        ('classroom', '0005_taughtcourse_upload_quota_bytes_and_more'),
    ]

    operations = [
        migrations.RunPython(split, merge),
    ]
