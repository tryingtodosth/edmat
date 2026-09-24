"""An organisation, the people on its roster, and the things it says it stands behind.

Management step A (MANAGEMENT-BRIEF.md §3.A). Three models, one rule module (`access.py`), one
kill switch (`organizations`).

**Why this is an app and not a field on a course or an event.** A student circle outlives every
course its members teach and every event it runs; a faculty stands behind forty of each. `Course.
organization` would model the one case something is run once by one body and nothing about the case
a body runs things for twenty years — and it would put the organisation's own roster nowhere.

**A membership grants nothing on what the organisation runs, by design.** This is the one decision
taken from 2donet and then deliberately narrowed (MANAGEMENT-BRIEF.md §1): 2donet cascades
permissions from an organisation down through teams to projects, and EdMat does not, because every
node here already has its own roster and its own rule module (`courses.Course.can_curate`,
`events.Event.can_organise`, `coauthoring.access.can_manage`). A cascade would be a *second* answer
to "who may edit this course", and two answers to one question is how two surfaces start
disagreeing. So `OrganizationLink` is informational — a badge and a list, nothing more — and
`config/nodes.py` answers authority for the node exactly as it did before this app existed.

**The link IS the relationship** (the `venues.RoomBooking` shape): a row pointing at a node through
`config.nodes`, not a nullable FK on the node, which is what keeps every other app's schema
untouched (MANAGEMENT-BRIEF.md §4 rule 1) and what lets two organisations stand behind one event —
a faculty that hosts it and a student circle that runs it — which a single FK cannot express.

`frontend/src/lib/utils/labels.ts` mirrors `ORGANIZATION_KIND_CHOICES`, `ORGANIZATION_ROLE_CHOICES`
and `LINK_KIND_CHOICES` below, and names this module from its side (house rule 13).
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

# What kind of body this is. Not a free-text field, because the whole value of the list at
# `/organizations` is being able to say "show me the student circles" — and not a taxonomy either,
# because a body's *subject* is already expressed by the disciplines of what it runs. `other` is
# deliberately present and deliberately last: a body that is none of these still exists, and forcing
# it into `ngo` would make the filter lie.
ORGANIZATION_KIND_CHOICES = [
    ('university', 'University'),
    ('faculty', 'Faculty or institute'),
    ('school', 'School'),
    ('student_circle', 'Student circle'),
    ('ngo', 'Non-governmental organisation'),
    ('company', 'Company'),
    ('other', 'Other'),
]

# Three fixed roles, never a checkbox permission editor and never a renameable custom role
# (MANAGEMENT-BRIEF.md §1, rejecting 2donet's `CustomRole`). An `owner` may do everything including
# removing another owner; an `admin` runs the roster and the links but may not remove an owner; a
# `member` is on the list and nothing more. Two manager tiers rather than one because "who may hand
# the organisation to somebody else" and "who may keep the page tidy" are genuinely different
# questions, and one tier makes every page-tidier able to evict the founder.
ORGANIZATION_ROLE_CHOICES = [
    ('owner', 'Owner'),
    ('admin', 'Administrator'),
    ('member', 'Member'),
]
#: The roles that may edit the organisation, its roster and its links. One frozenset so that "what
#: may a manager do" can never be spelled two ways in `access.py` and a serializer.
ORGANIZATION_MANAGER_ROLES = frozenset({'owner', 'admin'})

# What the organisation is claiming about the thing it points at. `runs` is "this is ours"; `supports`
# is "we are behind it" — a faculty that lends a lecture theatre and its name to a student circle's
# conference is supporting it, not running it, and a badge that could not tell the two apart would
# be read as the stronger claim every time.
LINK_KIND_CHOICES = [
    ('runs', 'Runs'),
    ('supports', 'Supports'),
]


class Organization(models.Model):
    """A body that stands behind things on the platform, with a roster of its own.

    Public by construction while `is_active`: an organisation exists in order to be found, and its
    name, kind and city are exactly what somebody looking for it searches by. `is_active=False` is
    the tombstone (house rule 12) — a body that dissolves still has to resolve for every link that
    names it, and its own members must still be able to open its page, so DELETE deactivates and
    `access.visible_organizations` narrows it to the roster rather than removing the row.
    """

    name = models.CharField(max_length=200)
    # The id every public URL uses, like Discipline, Branch and Venue (root CLAUDE.md, "Ids"):
    # `/organizations/kolo-naukowe-fizykow/` is a link somebody can send. Allocated once from the
    # name and immutable through the API, for the reason `concepts.services.allocate_slug` states.
    slug = models.SlugField(max_length=120, unique=True)
    kind = models.CharField(max_length=20, choices=ORGANIZATION_KIND_CHOICES, default='other')
    # Rich text in the project's own storage format (Markdown + literal LaTeX + raw-HTML
    # passthrough), sanitized in `save()` below rather than in a serializer — `config/sanitize.py`
    # says why that is the right place: every write path is then covered, including the admin and
    # any future seed command.
    description = models.TextField(blank=True)
    website = models.URLField(max_length=300, blank=True)
    city = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='organizations_founded',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        from config.sanitize import sanitize_content

        self.description = sanitize_content(self.description)
        super().save(*args, **kwargs)


class OrganizationMember(models.Model):
    """One person's standing inside one organisation.

    **At least one owner at all times.** Removing or demoting the last one is refused with the word
    `last_owner` (409) by `access.remove_block_reason` — the same reasoning `VenueStaff` gives for
    `last_administrator` and `EventStaff` gives for the host: an organisation nobody can administer
    is a page nobody can ever correct again, and there is no self-service "claim this organisation"
    flow to recover it with (MANAGEMENT-BRIEF.md §3.A, "Not in A").
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='members'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='organization_memberships'
    )
    role = models.CharField(max_length=20, choices=ORGANIZATION_ROLE_CHOICES, default='member')
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='organization_members_added',
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # `unique_together` rather than a `UniqueConstraint`, deliberately: DRF derives a uniqueness
        # validator from the first and NOT from the second (backend/CLAUDE.md, "Testing"), so this
        # spelling is what turns a duplicate into a 400 instead of a 500. The serializer checks it
        # too, because the POST path here does not run a ModelSerializer over the pair.
        unique_together = [('organization', 'user')]
        ordering = ['role', 'added_at']

    def __str__(self) -> str:
        return f'{self.user} @ {self.organization} ({self.role})'


class OrganizationLink(models.Model):
    """"This organisation runs / supports that course, event or material."

    A polymorphic target through a registry, the shape this codebase already uses four times
    (`community.Comment`, `moderation.Report`, `moderation.NodeGovernor`, `galleries.Gallery`) —
    and the registry here is `config.nodes.NODE_KINDS`, shared with the other five management steps
    rather than written again. `organizations.access.LINKABLE_KINDS` narrows it by one: an
    organisation does not link to an organisation, because "a faculty contains a student circle" is
    a structure this step deliberately does not model (MANAGEMENT-BRIEF.md §3.A, "Not in A") and a
    self-referential graph with no rules about cycles is worse than no graph.

    Creating a link needs BOTH `can_manage` on the organisation and `can_manage_node` on the target
    — a badge saying "run by the Faculty of Physics" is a claim about two parties, so both have to
    have agreed to it. `access.link_block_reason` is the one place that is decided.
    """

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='links')
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    kind = models.CharField(max_length=20, choices=LINK_KIND_CHOICES, default='runs')
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='organization_links_added',
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('organization', 'content_type', 'object_id')]
        ordering = ['-added_at']
        indexes = [models.Index(fields=['content_type', 'object_id'])]

    def __str__(self) -> str:
        return f'{self.organization} {self.kind} {self.content_type}#{self.object_id}'
