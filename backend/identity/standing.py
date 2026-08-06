"""What a verified identity is actually worth here — the "boost", in EdMat's own vocabulary.

LAUNCHCHECKLIST §3 already defines this, and the point of writing it here is to implement that
definition rather than invent a second, competing score beside it:

    effective_tier = max(usos_tier, min(rep_tier, verification_ceiling))

Reputation does not exist yet, so this module owns exactly one term of that expression — the
**verification ceiling** — and computes it from the ladder §3 already specifies. When the REP system
lands it supplies the other terms and this needs no revision. That is what "prepare the ground"
means concretely: the first term is real, the shape is right, and nothing has to be unpicked.

Four rules this follows, because a standing score is easy to get wrong.

1. **It is a ceiling on capability, never authority over other people.** §2b is explicit: mod level
   is never granted by identity, never by USOS. A verified first-year may upload, link, review and
   comment freely, and may do nothing whatsoever to anybody else's work.
2. **It is fully itemised.** `reasons` is the entire computation and the UI renders every line.
   Nobody should have to guess why they are where they are.
3. **It cannot be earned by typing.** Self-declaring a school is worth zero on purpose — if it were
   worth anything, it would be worth exactly as much to somebody lying.
4. **Capability does not depend on publishing anything.** Skill seeded from a transcript comes from
   the *import*, not from the consent to display it, so nothing here quietly pressures a person into
   publishing their marks in order to keep up. Consent governs who can see; it never governs what
   you may do.
"""

from __future__ import annotations

from .models import EducationProfile, Verification, weighted_average

#: Ascending. 'F' is suspension, which nothing in this module can cause — it is listed only so the
#: ordering below is the same one §2a uses.
TIER_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S']


def _highest(*tiers: str) -> str:
    return max(tiers, key=TIER_ORDER.index)


def ceiling_for(profile: EducationProfile | None, user=None) -> dict:
    """The verification ceiling this account has reached, and exactly what put it there."""
    reasons: list[dict] = []
    tier = 'E'

    # Step 1 of §3's ladder. Django's own `User.is_active` is the closest thing this codebase has to
    # a confirmed address today; there is no email-confirmation flow yet, which is itself a known
    # open item on the checklist. Named honestly rather than silently treated as confirmation.
    if user is not None and user.is_active:
        reasons.append(
            {
                'code': 'account_active',
                'tier': 'E',
                'detail': 'Active account. Email confirmation is not built yet, so this is the '
                'weakest rung and is counted as such.',
            }
        )

    if profile is None:
        return {'tier': tier, 'reasons': reasons, 'usos_tier': None, 'skill_seeds': []}

    # Step 2 — a declared field of study, plus a name to attach it to.
    if profile.school_label and (profile.programme or profile.other_school_name or profile.school):
        tier = _highest(tier, 'D')
        reasons.append(
            {
                'code': 'declared_school',
                'tier': 'D',
                'detail': f'Declared {profile.school_label}. Self-declared, so it is worth the '
                'step it is worth and no more.',
            }
        )

    # Step 3 — an institutional address. A real claim, and a genuinely weaker one than enrolment:
    # it proves the address, not that the holder is currently a student.
    if profile.verification == Verification.SCHOOL_EMAIL:
        tier = _highest(tier, 'C')
        reasons.append(
            {
                'code': 'school_email',
                'tier': 'C',
                'detail': 'Signed in with an address on the institution\'s own domain. This proves '
                'the address, not the affiliation.',
            }
        )

    # §3a — the whole point of the USOS work. Replaces steps 3–6 at once, because it is a far
    # stronger claim than any of them were approximating.
    usos_tier = None
    if profile.verification == Verification.USOS and profile.usos_connected:
        usos_tier = 'S'
        tier = _highest(tier, 'S')
        reasons.append(
            {
                'code': 'usos_verified',
                'tier': 'S',
                'detail': 'Enrolment confirmed by the university\'s own registry. This is the '
                'strongest identity claim available here, and it grants full participation — and '
                'no authority whatsoever over other people\'s work.',
            }
        )

    return {
        'tier': tier,
        'usos_tier': usos_tier,
        'reasons': reasons,
        'skill_seeds': skill_seeds_for(profile),
        'average': weighted_average(list(profile.grades.all())),
    }


def skill_seeds_for(profile: EducationProfile | None) -> list[dict]:
    """Courses on this site the registry says this person has actually passed.

    §3a's "seeded SKILL from real enrolment": someone who passed Analiza Matematyczna II has an
    institutionally-attested claim to competence in it that no amount of upvoting establishes as
    cheaply. Deliberately conservative and deliberately labelled *evidence*, not proof — having
    taken a course is not the same as being good at it, and the seed is sized accordingly.

    Only ever drawn from grades that actually matched a real `taxonomy.Branch`. An unmatched result
    is still a real result; it is simply not one this site can place, and inventing a placement for
    it would be worse than leaving it out.
    """
    if profile is None:
        return []
    seeds: list[dict] = []
    for grade in profile.grades.select_related('matched_course').all():
        if grade.matched_course is None:
            continue
        # A pass is a pass. The distinction that matters for a seed is passed/not, not 3.0 vs 5.0 —
        # grading is not comparable enough between courses to read more into it than that.
        if grade.scale == 'polish_2_5' and float(grade.value) < 3.0:
            continue
        seeds.append(
            {
                'branch_slug': grade.matched_course.slug,
                'course_name': grade.name,
                'ects': grade.ects,
                'basis': 'passed, per the university registry',
            }
        )
    return seeds


def public_view(profile: EducationProfile | None) -> dict | None:
    """Exactly as much of the above as consent allows a stranger to see — and no more.

    Three independent gates, checked one at a time rather than as a single "is anything public"
    flag, because that is the difference between "I am a student here" and "here is my transcript"
    and a person may reasonably want the first without the second.
    """
    if profile is None or not profile.share_school:
        return None

    out: dict = {
        'school': profile.school_label,
        'verification': profile.verification,
        'status': profile.status,
        'programme': profile.programme,
        'diplomas': [],
        'grades': [],
        'average': None,
    }

    if profile.share_diploma:
        out['diplomas'] = [
            {
                'title': d.title,
                'programme': d.programme,
                'issued_on': d.issued_on.isoformat() if d.issued_on else '',
                'final_grade': d.final_grade,
            }
            for d in profile.diplomas.all()
        ]

    if profile.share_grades:
        grades = list(profile.grades.all())
        out['grades'] = [
            {
                'name': g.name,
                'term': g.term,
                'ects': g.ects,
                'value': g.value,
                'scale': g.scale,
                'branch_slug': g.matched_course.slug if g.matched_course else None,
            }
            for g in grades
        ]
        out['average'] = weighted_average(grades)

    return out
