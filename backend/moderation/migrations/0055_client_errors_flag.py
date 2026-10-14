# The `client_errors` kill switch (analytics/client_errors.py, 2026-10-14): the browser error beacon
# of LINKING-AND-ERRORS.md §3.3. Seeded ON — the owner approved the beacon the day it was built. The
# other two files of the three-file change are `frontend/src/lib/types/featureFlag.ts` and
# `frontend/src/lib/utils/labels.ts`.


from django.db import migrations, models

KEY = 'client_errors'


def seed_flag(apps, schema_editor):
    FeatureFlag = apps.get_model('moderation', 'FeatureFlag')
    FeatureFlag.objects.get_or_create(key=KEY, defaults={'is_enabled': True})


def unseed_flag(apps, schema_editor):
    apps.get_model('moderation', 'FeatureFlag').objects.filter(key=KEY).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('moderation', '0054_social_login_flag'),
    ]

    operations = [
        migrations.AlterField(
            model_name='featureflag',
            name='key',
            field=models.CharField(choices=[('tutoring', 'Tutoring/services listings'), ('courses', 'User-run courses'), ('messaging', 'User-to-user messaging'), ('exercise_submissions', 'New exercise submissions'), ('material_submissions', 'New material uploads'), ('events', 'One-off events'), ('issues', 'Site issue reports'), ('posts', 'Activity micro-posts'), ('chemistry', 'Chemistry drawings (Ketcher)'), ('sketches', 'Freehand sketches (whiteboard)'), ('venues', 'Venues, rooms and checklists'), ('event_documents', 'Event documents and briefings'), ('tickets', 'Tickets, QR codes and scanning'), ('shifts', 'Volunteer rota (shifts)'), ('cloakroom', 'Cloakroom desk'), ('role_preview', 'View an event as a visitor'), ('organizations', 'Organisations'), ('tasks', 'Tasks on courses, events and materials'), ('needs', 'Needs board (help wanted)'), ('plans', 'Plans and roadmaps'), ('decisions', 'Decisions and polls'), ('work_dashboard', 'Personal work dashboard'), ('volunteering', 'Volunteering offers (people offering to help)'), ('school_demo', 'School-management demo (/dziennik)'), ('flashcards', 'Flashcards: decks and spaced review'), ('learning_record', 'Learning record on public profiles'), ('creation_requires_verification', 'Creating courses, events, listings and organisations: verified contributors only'), ('ai_assisted', 'The "AI-assisted" mark: author marks and community votes'), ('goals', 'Goals and their definitions of done'), ('attachments', 'Attachments on courses, events, board rows and comments'), ('contests', 'Contests: staged competitions with a jury, results and the obligations a prize brings'), ('social_login', 'Sign in with Google, Apple or Microsoft'), ('client_errors', 'Browser error reports (no cookie, no identifier)'), ('material_uploads_verified_only', 'Material uploads: verified contributors only'), ('galleries', 'Picture galleries on content'), ('age_verification', 'Age gate on self-registration'), ('coauthoring', 'Co-authoring materials: versions, teams, proposals'), ('concepts', 'Concepts: wiki articles per audience'), ('about_discussions', 'Discussions under the standing pages (/about and the manual)')], max_length=40, unique=True),
        ),
        migrations.RunPython(seed_flag, unseed_flag),
    ]
