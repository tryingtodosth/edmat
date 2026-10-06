"""Remove the `DiscussionLocation` rows nobody ever decided anything about.

The page allowlist for standing-page discussions is a **pattern**, not a list
(`community/discussions.py`, "The page allowlist is a pattern"), because the manual's sections live
in TypeScript and Python cannot read them. What that costs is named in the module docstring and was
`todo.md`'s own last bullet: a well-formed junk key — `about/nonsense#whatever` — makes a row that
shows up in the moderator's list with no comments under it. Rows left behind by the pre-2026-10-06
POST, which created the location one line above the parent check that could still refuse the write,
are the other source. Neither is a decision; both are litter.

**This is not a hole in house rule 12, and the three conditions together are why.** A row is a
candidate only when all of these hold:

    no comments        not one, of any kind — not a public one, not a tombstone, not one held for
                       a moderator. A tombstone is a record that something was said and removed,
                       and deleting the row under it would orphan that record.
    default settings   `is_enabled`, `audience` and `moderated` are exactly what
                       `discussions.effective_policy` would answer with if the row did not exist,
                       so removing it changes what the location allows by nothing at all.
    `updated_by` is NULL   nobody's name is on it. A row a moderator touched carries who touched
                       it and when, and that IS the decision house rule 12 keeps.

A row failing any one of them is never a candidate. That is also why this is a management command
and `DiscussionLocationViewSet` still refuses `destroy`: a `destroy` would be for a row somebody
decided about, and there is no honest version of that. Closing a location is `is_enabled=False`.

    manage.py sweep_discussion_locations --dry-run     # prints what it would remove
    manage.py sweep_discussion_locations               # removes it

`--dry-run` first is the documented order, and the command prints the same list either way so the
two runs can be compared.
"""

from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand
from django.db.models import Count

from community import discussions
from community.models import Comment, DiscussionLocation


def sweep_candidates():
    """The rows this command would remove, newest spelling of the three conditions in one place.

    A queryset rather than a list, so a caller can `.count()` it without building the rows — and
    annotated rather than filtered in Python, because "has no comments" over an indexed
    (content_type, object_id) pair is one `COUNT` the database already knows how to do (house
    rule 5: recount, never increment).
    """
    content_type = ContentType.objects.get_for_model(DiscussionLocation)
    comment_counts = {
        object_id: n
        for object_id, n in Comment.objects.filter(content_type=content_type)
        .values_list('object_id')
        .annotate(n=Count('id'))
    }
    untouched = DiscussionLocation.objects.filter(
        updated_by__isnull=True,
        is_enabled=True,
        audience=discussions.DEFAULT_AUDIENCE,
        moderated=discussions.DEFAULT_MODERATED,
    )
    return [row for row in untouched if comment_counts.get(row.pk, 0) == 0]


class Command(BaseCommand):
    help = 'Delete discussion locations with no comments, default settings and nobody attached.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List the rows that would be removed and change nothing.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        total = DiscussionLocation.objects.count()
        candidates = sweep_candidates()

        self.stdout.write(f'{total} discussion location(s); {len(candidates)} candidate(s).')
        for row in candidates:
            self.stdout.write(f'  {discussions.location_key(row.page, row.section)}')

        if dry_run:
            self.stdout.write('--dry-run: nothing removed.')
            return
        if not candidates:
            self.stdout.write('Nothing to remove.')
            return

        DiscussionLocation.objects.filter(pk__in=[row.pk for row in candidates]).delete()
        self.stdout.write(self.style.SUCCESS(f'Removed {len(candidates)} location(s).'))
