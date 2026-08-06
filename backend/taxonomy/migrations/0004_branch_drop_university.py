"""`university` leaves the taxonomy.

It was the clearest evidence that przedmiot never belonged here: a branch of mathematics is not
owned by a university, and every one of the four rows carrying this column said the same thing
('Uniwersytet Warszawski'). Where a university genuinely matters — "this class, taught here, this
semester" — is on a `courses.Course`, which is where it now lives.

Dropping rather than migrating the values: all four rows held one identical string, and there are no
Course rows for it to move onto. Preserving it would mean inventing offerings nobody has created.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('taxonomy', '0003_discipline_branch_rename'),
    ]

    operations = [
        migrations.RemoveField(model_name='branch', name='university'),
    ]
