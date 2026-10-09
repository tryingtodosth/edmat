"""A contest in the feed: the `contest` link and the two new kinds (CONTESTS-BRIEF.md §3.B).

The one migration step B of the contests cycle writes, and it is deliberately in `activity` and
not in `contests` — §4 rule 1 of that brief: step A owns every migration in `contests/`, and the
thing being added here is a column on `ActivityEvent`, which belongs to this app.

A typed FK rather than only the generic `source` because every other destination in this table is
one: `remove_activity_for` reads the field names, `feed_events` joins on them, and the serializer
sends `contest` so the frontend can build `/contests/5` without a second request. Nullable and
CASCADE, like the first six.
"""


import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('activity', '0007_activityevent_concept_alter_activityevent_kind'),
        ('contests', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='activityevent',
            name='contest',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='+', to='contests.contest'),
        ),
        migrations.AlterField(
            model_name='activityevent',
            name='kind',
            field=models.CharField(choices=[('exercise', 'New exercise'), ('material', 'New material'), ('material_version', 'New material version'), ('solution_entry', 'New solution/hint'), ('translation', 'New translation'), ('course', 'New course'), ('event', 'New event'), ('service', 'New tutoring listing'), ('post', 'New post'), ('review', 'New review'), ('claim', 'New claim'), ('comment', 'New comment'), ('concept', 'New concept'), ('concept_revision', 'New concept revision'), ('contest', 'New contest'), ('contest_results', 'Contest results published')], max_length=20),
        ),
    ]
