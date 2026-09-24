"""Site issue reports — "Report issue / Zgłoś błąd" — and what makes them distinct from
`moderation.Report`.

A `Report` flags one piece of content (an exercise, a comment, a review) so a moderator can decide
whether it stays. An `Issue` is about the SITE: something broken, a wrong solution the reporter
cannot point a moderation report at, an idea, anything else — filed from wherever the person was
standing when it occurred to them, which is why the page they were on travels with it.

Three decisions worth stating, because each was asked and answered:

- **Anonymity is real, not cosmetic.** An anonymous report stores no reporter and no email — not
  "hidden from the public but kept for staff". The cost is that nobody can follow up with that
  person, and the settings copy says so. A guest can report too; they are anonymous unless they
  leave an email.
- **Publication is the reporter's choice.** An issue the reporter did not allow to be published is
  visible to staff only, ever; a published one has a page of its own with a discussion thread. The
  reporter — when there is one — is told when its status changes, which is what they get instead of
  being able to revisit a private report.
- **Status is one field**, not `is_resolved` + `is_closed`, for the reason every other status in
  this codebase gives: two booleans make an illegal fourth state representable.
- **Where a report came from is a column, not a string in `context`.** `source` and `area` were
  added when the school-management demo (`school-management-demo/`, 2026-09-24) started filing into
  this table: it is one Node process serving a whole school system, and "the grade book is wrong"
  and "the site's exercise browser is wrong" are different queues answered by different people.
  `context` is prose for a human to read and this app never queries it, so a category that staff
  filter by cannot live there. `kind` stays what it always was — what sort of problem — and these
  two say which product and which part of it, which is why they are *additional* rather than more
  `kind` choices.
"""

from django.conf import settings
from django.db import models

ISSUE_KIND_CHOICES = [
    ('bug', 'Something is broken'),
    ('content', 'Wrong or misleading content'),
    ('idea', 'An idea or suggestion'),
    ('other', 'Something else'),
]

ISSUE_STATUS_CHOICES = [
    ('open', 'Open'),
    ('in_progress', 'In progress'),
    ('resolved', 'Resolved'),
    ('closed', 'Closed without action'),
]

# Which product the report was filed from. 'site' is EdMat itself and stays the default, so every
# row written before this field existed — and every report the site's own modal files — reads as
# what it actually is without a data migration inventing anything.
ISSUE_SOURCE_CHOICES = [
    ('site', 'The EdMat site'),
    ('school_demo', 'School-management demo'),
]

# Which part of that product. Mirrors the demo's own module registry
# (`school-management-demo/server/modules.js` — MODULES), because that registry is already what the
# demo switches on and off per school, so its ids are the divisions the people running a pilot
# actually think in. Kept as a plain list rather than imported: the demo is a separate Node process
# with no Python to import, and a copied enum that drifts is caught by
# `IssueCategoriesTests.test_area_choices_match_the_demo_module_registry`, which reads its file.
ISSUE_AREA_CHOICES = [
    ('core', 'Core (login, sessions, audit)'),
    ('logbook', 'Lesson logbook (attendance, topics, homework)'),
    ('grades', 'Grades and remarks'),
    ('homeroom', 'Homeroom and classification'),
    ('principal', 'Principal: substitutions, supervision, audit'),
    ('support', 'Psychological and pedagogical support'),
    ('registry', 'Registrar and administration'),
    ('student', 'Student account'),
    ('parent', 'Parent account'),
    ('messages', 'Messages and notifications'),
    ('school', 'After-school care, cafeteria, trips, library, nurse'),
    ('courses', 'Courses and materials (LMS)'),
    ('meetings', 'Video meetings'),
    ('compliance', 'Compliance pack'),
    ('demo', 'Demo mode and feedback'),
]

# Which sources have areas at all. The site does not: it has its own navigation and the page the
# person was on already travels in `context.path`, so an `area` on a site report would be a second,
# emptier answer to a question `context` answers better. One dict rather than an `if` in the
# serializer, so adding a third source is a line here instead of a branch somewhere.
SOURCE_AREAS = {
    'site': (),
    'school_demo': tuple(key for key, _ in ISSUE_AREA_CHOICES),
}


def area_is_valid_for(source: str, area: str) -> bool:
    """The one place that answers "may this report carry this area?" — asked by the create
    serializer, and by anything that later files an issue on a reporter's behalf."""
    if not area:
        return True
    return area in SOURCE_AREAS.get(source, ())


class Issue(models.Model):
    kind = models.CharField(max_length=10, choices=ISSUE_KIND_CHOICES, default='bug')
    # See the module docstring. Indexed together because the only query either one appears in is
    # staff narrowing the queue to one product, and then to one part of it.
    source = models.CharField(max_length=20, choices=ISSUE_SOURCE_CHOICES, default='site', db_index=True)
    # Blank for a source that has no areas, which today is the site itself.
    area = models.CharField(max_length=20, choices=ISSUE_AREA_CHOICES, blank=True, default='', db_index=True)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    # Where the person was when they filed it, captured by the client by default and editable
    # before sending: the page path, its title, the interface locale, the viewport and the browser.
    # A dict rather than five columns because it is context for a human reading the report, never
    # something this app queries by.
    context = models.JSONField(default=dict, blank=True)
    # NULL for an anonymous report — genuinely absent, not hidden (see the module docstring) — and
    # for a guest. SET_NULL, so deleting an account turns their reports anonymous rather than
    # deleting the record of a real problem.
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        related_name='issues',
        on_delete=models.SET_NULL,
    )
    # The one way a guest who wants a reply can be reached. Blank on an anonymous report.
    contact_email = models.EmailField(blank=True)
    # The reporter's own answer to "may this be published?". Staff can flip it off afterwards
    # (a report that turns out to contain somebody's personal data), never on.
    is_public = models.BooleanField(default=False)
    status = models.CharField(max_length=12, choices=ISSUE_STATUS_CHOICES, default='open')
    # What staff said when they changed the status — shown on the issue page and carried in the
    # reporter's notification.
    staff_note = models.TextField(blank=True)
    status_changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        where = f'{self.source}:{self.area}' if self.area else self.source
        return f'[{where}][{self.kind}/{self.status}] {self.title}'
