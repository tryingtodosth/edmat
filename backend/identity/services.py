"""Connecting a USOS link, and transferring what it offers.

Extracted out of `views.py` because it has a second caller that is not an HTTP request:
`accounts.management.commands.seed_profile_showcase` builds a demonstration transcript, and it has to
build it *through the real import path* rather than by writing plausible-looking rows of its own. A
seed that hand-rolls its own version of this is a seed that keeps showing whatever the feature used to
do, which is the opposite of what demonstration data is for — and it would drift silently, since
nothing would fail when the two disagreed.

Nothing about the consent model changes by living here: **importing still publishes nothing.** None of
these functions touches `share_school`/`share_diploma`/`share_grades`, exactly as before.
"""

from __future__ import annotations

from django.utils import timezone

from taxonomy.models import Branch

from . import usos
from .models import CourseGrade, Diploma, EducationProfile, Verification, academic_year_of


def connect_usos(profile: EducationProfile, user, *, include_grades: bool) -> bool:
    """Open a link for this profile's declared institution. False when the connector cannot.

    `include_grades` is a second, separate authorization rather than a flag on the first — see
    `usos.py`'s own header for why that distinction is load-bearing rather than tidy.
    """
    if profile.school is None:
        return False

    scopes = list(usos.BASE_SCOPES)
    if include_grades:
        scopes.append(usos.GRADES_SCOPE)

    connector = usos.active_connector()
    session = connector.connect(profile.school, tuple(scopes), user)
    if session is None:
        return False

    profile.usos_user_id = session.user_id
    profile.usos_student_number = session.student_number
    profile.usos_scopes = list(session.scopes)
    profile.usos_connected_at = timezone.now()
    profile.verification = Verification.USOS
    profile.verified_via = 'usos'
    profile.verified_at = timezone.now()
    profile.status = usos.status_from_usos(session.student_status)

    programmes = connector.fetch_programmes(session)
    if programmes:
        profile.programme = programmes[0].name
        profile.study_year = programmes[0].year
    profile.save()
    return True


def session_for(profile: EducationProfile) -> usos.UsosSession:
    """The link as the connector wants it, rebuilt from the stored row.

    Carries no token, deliberately — see `EducationProfile`'s own note on why no such column exists.
    """
    return usos.UsosSession(
        school_slug=profile.school.slug,
        scopes=tuple(profile.usos_scopes),
        user_id=profile.usos_user_id,
        student_number=profile.usos_student_number,
    )


def import_diplomas(profile: EducationProfile) -> int:
    """Replace the stored diplomas with whatever the registry currently reports."""
    connector = usos.active_connector()
    records = connector.fetch_diplomas(session_for(profile))
    profile.diplomas.all().delete()
    for record in records:
        Diploma.objects.create(
            profile=profile,
            title=record.title,
            level=record.level,
            programme=record.programme,
            issued_on=record.issued_on or None,
            final_grade=record.final_grade,
            source_id=record.source_id,
        )
    profile.usos_last_synced_at = timezone.now()
    profile.save()
    return len(records)


def import_grades(profile: EducationProfile, years: list[str] | None = None) -> int:
    """Transfer a transcript — the whole thing, or only the academic years named.

    The two are genuinely different requests, and the difference decides what gets deleted:

    * **No `years`** — "transfer my transcript". The registry's answer is the whole truth, so the
      stored copy is replaced outright; a course the registry no longer reports is a course that
      should stop being on this profile.
    * **`years` given** — "transfer these years". The request says nothing about the other years, so
      neither does the write: exactly those years are replaced and the rest are left alone. Wiping
      them would silently discard a transfer the person made earlier and did not ask to undo.

    By ACADEMIC YEAR rather than by term id, because the year is the unit the UI offers and the unit
    somebody thinks in ("I don't want my first year on there"). Accepting both axes would need a
    precedence rule for the case where they disagree, for a granularity nobody has asked for.
    """
    connector = usos.active_connector()
    records = connector.fetch_grades(session_for(profile))

    # **An empty answer never deletes anything.** A full transfer replaces the stored copy, which is
    # right when the registry actually answered — and catastrophic when it did not: an unreachable
    # installation, an expired authorization, or a deployment running the unconfigured connector all
    # return `[]`, and the previous version of this took that as "you have no results any more" and
    # dropped a transcript somebody had transferred. Found by running exactly that case by accident,
    # not by reasoning about it.
    #
    # A student who genuinely has no results yet also lands here, and is served correctly: there was
    # nothing to store either way, and the caller is told 0 rather than being told a lie.
    if not records:
        return 0

    if years is not None:
        wanted = {y.strip() for y in years if y.strip()}
        records = [r for r in records if academic_year_of(r.term) in wanted]
        doomed = [g.pk for g in profile.grades.all() if academic_year_of(g.term) in wanted]
        profile.grades.filter(pk__in=doomed).delete()
    else:
        profile.grades.all().delete()

    for record in records:
        CourseGrade.objects.create(
            profile=profile,
            code=record.code,
            name=record.name,
            term=record.term,
            ects=record.ects,
            value=record.value,
            scale=record.scale,
            matched_course=match_course(record.name),
        )
    profile.usos_last_synced_at = timezone.now()
    profile.save()
    return len(records)


def remove_grades(profile: EducationProfile, year: str = '') -> int:
    """Delete an imported transcript, or one academic year of it. Returns how many rows went.

    **`year` is not a convenience wrapper around the same operation, and the consent flag is why.**
    Removing everything leaves nothing to share, so `share_grades` is turned off with it — leaving a
    consent switched on over an empty record would be a promise about data that no longer exists.
    Removing ONE year leaves the rest, so the flag is deliberately untouched: the person still wants
    the years they kept to be visible, and silently un-publishing them because they pruned a different
    year would be the app overruling a decision they made separately.
    """
    year = (year or '').strip()
    if year:
        doomed = [g.pk for g in profile.grades.all() if academic_year_of(g.term) == year]
        profile.grades.filter(pk__in=doomed).delete()
        removed = len(doomed)
    else:
        removed = profile.grades.count()
        profile.grades.all().delete()
        profile.share_grades = False
    profile.save()
    return removed


def match_course(name: str) -> Branch | None:
    """Best-effort match of a registry course onto this site's own taxonomy.

    Deliberately conservative — a wrong match would attach a competence claim to the wrong corner of
    the site, which is worse than no match at all. Exact-ish name matching only; anything cleverer
    needs a real course-code mapping per university, which is its own piece of work.
    """
    if not name:
        return None
    needle = name.strip().lower()
    for branch in Branch.objects.filter(published=True).prefetch_related('translations'):
        for translation in branch.translations.all():
            title = (getattr(translation, 'name', '') or '').strip().lower()
            if title and (title == needle or needle.startswith(title)):
                return branch
    return None
