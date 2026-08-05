"""Institutions, and what a person's institution is allowed to say about them.

Three ideas, kept deliberately separate because they are three different questions:

1. **`School`** — the institutions EdMat knows about, and which of them run USOS.
2. **`EducationProfile`** — what one account claims, how strongly that claim is backed, and — as
   three independent flags that all start off — how much of it may be shown to anybody else.
3. **`Diploma` / `CourseGrade`** — records imported from an institution's own registry, which exist
   whether or not the account holder ever chooses to publish them.

The split between (2) and (3) is the load-bearing one: *importing* something and *publishing* it are
never the same decision here. A student who connects USOS to prove they are a student and never
shows a single mark is the case this is shaped around, not an edge case it tolerates.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class GradeScale(models.TextChoices):
    #: The 2.0–5.0 scale used by essentially every Polish university, including the half-grades.
    POLISH_2_5 = 'polish_2_5', 'Polish 2.0–5.0'
    #: A–F. Deliberately never converted into the scale above: there is no mapping a registrar
    #: would sign, and inventing one would quietly turn somebody's transcript into a number their
    #: institution never issued.
    ECTS_LETTER = 'ects_letter', 'ECTS letter'


class School(models.Model):
    """One institution.

    `email_domains` is the field doing the real work. An address on an institution's own domain is
    what makes a sign-in verifiably institutional rather than self-declared, so matching is strict —
    an exact domain or a subdomain of one, never a substring. A faculty address like
    `@fuw.edu.pl` matches its own entry, while `uw.edu.pl.example.com` matches nothing, because a
    looser rule would let anybody mint a verification badge by registering a hostname.

    `usos_base_url` being blank is meaningful rather than missing data: several institutions here
    genuinely run no USOS installation, and the UI has to say so instead of offering a button whose
    only possible outcome is failure.
    """

    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=200)
    short_name = models.CharField(max_length=32)
    country = models.CharField(max_length=2, default='PL')
    city = models.CharField(max_length=100, blank=True)
    email_domains = models.JSONField(default=list)
    grade_scale = models.CharField(
        max_length=20, choices=GradeScale.choices, default=GradeScale.POLISH_2_5
    )
    # Conventionally https://usosapi.<host>/ , but several installations deviate and every one of
    # these must be confirmed against the consortium's own registry before a real call is made.
    # Recorded per school precisely because USOS is a per-institution deployment, not one service.
    usos_base_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['country', 'name']

    def __str__(self) -> str:
        return self.short_name

    @property
    def runs_usos(self) -> bool:
        return bool(self.usos_base_url)

    def matches_email(self, email: str) -> bool:
        domain = email.rsplit('@', 1)[-1].strip().lower() if '@' in email else ''
        if not domain:
            return False
        return any(
            domain == d.lower() or domain.endswith('.' + d.lower()) for d in self.email_domains
        )

    @classmethod
    def for_email(cls, email: str) -> 'School | None':
        if '@' not in email:
            return None
        for school in cls.objects.filter(is_active=True):
            if school.matches_email(email):
                return school
        return None


class Verification(models.TextChoices):
    """Three genuinely different strengths of claim, and the difference is the whole point."""

    #: Typed into a box. Believed by nobody, worth nothing, and shown without a tick.
    SELF_DECLARED = 'self_declared', 'Self-declared'
    #: The address is on the institution's domain. It proves the address; it says nothing about
    #: whether the holder is a current student, an alumnus, or a member of staff.
    SCHOOL_EMAIL = 'school_email', 'Institutional email'
    #: The institution's own student registry answered. This is the only one that can state
    #: enrolment, and it is why USOS is worth the per-institution effort it costs.
    USOS = 'usos', 'USOS'


class StudentStatus(models.TextChoices):
    UNKNOWN = 'unknown', 'Unknown'
    STUDENT = 'student', 'Current student'
    ALUMNUS = 'alumnus', 'Alumnus'
    STAFF = 'staff', 'Staff'


class EducationProfile(models.Model):
    """One account's education claim, plus the consent that governs who may see it.

    Kept out of `accounts.Profile` on purpose. That model is loaded on every authenticated page
    (`GET /auth/me/`) and is a settings bag; this one carries a transcript and a diploma, is read on
    exactly two screens, and has a materially different privacy weight. Merging them would mean
    every ordinary profile read pulls somebody's academic record along with it.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, related_name='education', on_delete=models.CASCADE
    )
    school = models.ForeignKey(
        School, related_name='members', null=True, blank=True, on_delete=models.SET_NULL
    )
    # Secondary schools are deliberately not enumerated — there are tens of thousands in this
    # market — so "my school is not listed" is a real first-class answer that simply carries no
    # verification, which is the honest outcome rather than a gap to be papered over.
    other_school_name = models.CharField(max_length=200, blank=True)

    verification = models.CharField(
        max_length=20, choices=Verification.choices, default=Verification.SELF_DECLARED
    )
    status = models.CharField(
        max_length=20, choices=StudentStatus.choices, default=StudentStatus.UNKNOWN
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_via = models.CharField(max_length=20, blank=True)

    programme = models.CharField(max_length=200, blank=True)
    study_year = models.PositiveSmallIntegerField(null=True, blank=True)

    # --- USOS link -------------------------------------------------------------------------
    # There is deliberately NO access-token column here. A real USOS token — especially one carrying
    # `offline_access` — is a long-lived credential to somebody's academic record, and this project
    # ships an unencrypted SQLite file that is trivially readable by anything with filesystem
    # access. When the real client lands, the token belongs in a dedicated encrypted store keyed by
    # this row, not in a column beside the student number. Recording that here rather than adding
    # the column now, because a plaintext token column is exactly the wrong ground to lay.
    usos_user_id = models.CharField(max_length=64, blank=True)
    usos_student_number = models.CharField(max_length=64, blank=True)
    usos_connected_at = models.DateTimeField(null=True, blank=True)
    usos_last_synced_at = models.DateTimeField(null=True, blank=True)
    usos_scopes = models.JSONField(default=list, blank=True)

    # --- consent ---------------------------------------------------------------------------
    # Three independent flags, all starting False. Nothing about connecting an account, and nothing
    # about importing a record, turns any of them on.
    share_school = models.BooleanField(default=False)
    share_diploma = models.BooleanField(default=False)
    share_grades = models.BooleanField(default=False)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f'{self.user.username} — {self.school or self.other_school_name or "unset"}'

    @property
    def school_label(self) -> str:
        if self.school:
            return self.school.name
        return self.other_school_name

    @property
    def usos_connected(self) -> bool:
        return bool(self.usos_user_id)

    def clear_usos(self) -> None:
        """Disconnecting falls back to the email verification rather than to nothing.

        That one was never USOS's to grant — the institutional address is still an institutional
        address — so revoking the stronger claim must not silently revoke the weaker one underneath
        it.
        """
        self.usos_user_id = ''
        self.usos_student_number = ''
        self.usos_connected_at = None
        self.usos_last_synced_at = None
        self.usos_scopes = []
        if self.verification == Verification.USOS:
            self.verification = (
                Verification.SCHOOL_EMAIL
                if self.verified_via == 'school'
                else Verification.SELF_DECLARED
            )
        self.status = StudentStatus.UNKNOWN


class Diploma(models.Model):
    """A completed degree, as the institution's own registry reports it."""

    profile = models.ForeignKey(
        EducationProfile, related_name='diplomas', on_delete=models.CASCADE
    )
    title = models.CharField(max_length=200)
    level = models.CharField(max_length=64, blank=True)
    programme = models.CharField(max_length=200, blank=True)
    issued_on = models.DateField(null=True, blank=True)
    final_grade = models.CharField(max_length=16, blank=True)
    #: The registry's own identifier for this record, so a re-import updates rather than duplicates.
    source_id = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ['-issued_on', 'title']

    def __str__(self) -> str:
        return self.title


class CourseGrade(models.Model):
    """One course result.

    `matched_course` is the reason importing a transcript is worth more here than a badge would be.
    EdMat's whole content tree hangs off `taxonomy.Course`, so a result in a course the registry
    names is an institutionally-attested claim to competence in a specific corner of this site —
    which is what LAUNCHCHECKLIST §3a means by seeding skill from real enrolment. Nullable because
    matching is best-effort: an unmatched course is still a real result, just not one this site can
    place.
    """

    profile = models.ForeignKey(EducationProfile, related_name='grades', on_delete=models.CASCADE)
    code = models.CharField(max_length=64, blank=True)
    name = models.CharField(max_length=200)
    term = models.CharField(max_length=32, blank=True)
    ects = models.PositiveSmallIntegerField(default=0)
    value = models.CharField(max_length=16)
    scale = models.CharField(
        max_length=20, choices=GradeScale.choices, default=GradeScale.POLISH_2_5
    )
    matched_course = models.ForeignKey(
        'taxonomy.Course',
        related_name='imported_grades',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    class Meta:
        ordering = ['term', 'name']

    def __str__(self) -> str:
        return f'{self.name}: {self.value}'


def weighted_average(grades) -> float | None:
    """ECTS-weighted, because that is how every institution on this list computes it.

    An unweighted mean across a 30-credit thesis and a 2-credit elective is not an average of
    anything. Returns None rather than guessing when the scales are mixed: there is no honest way to
    fold an ECTS letter into the Polish 2–5 scale, so a transcript containing both simply has no
    single number, and saying so is better than inventing one.
    """
    numeric = [g for g in grades if g.scale == GradeScale.POLISH_2_5]
    if not numeric or len(numeric) != len(list(grades)):
        return None
    total_credits = sum(g.ects for g in numeric)
    if total_credits == 0:
        return None
    weighted = sum(float(g.value) * g.ects for g in numeric)
    return round(weighted / total_credits, 2)
