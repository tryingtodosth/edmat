# The learning record's own consent (prompts/03-learning-record.md, 2026-10-05): the fourth flag of
# the shape `share_school` / `share_diploma` / `share_grades` already established, off by default
# like all three of them. Adding a column with `default=False` publishes nothing about anybody —
# which is the whole reason the default is not `True` "because the counts are harmless".

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('identity', '0002_seed_schools'),
    ]

    operations = [
        migrations.AddField(
            model_name='educationprofile',
            name='share_activity',
            field=models.BooleanField(default=False),
        ),
    ]
