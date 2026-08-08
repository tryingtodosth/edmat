"""The USOS seam: everything a real client will plug into, and nothing pretending to be one.

USOS is the student-records system essentially every Polish university runs, and connecting to it is
the only way EdMat can learn — from the institution's own database rather than from anything a
visitor typed — that somebody is a real, currently enrolled person, which of them they are, and what
they study.

**What blocks a real connection is not code.** USOS API issues credentials *per institution*, by
that institution, to a named application, after a request a human there approves. There is no global
key: connecting to twelve universities is twelve registrations. That is encoded in the design here
(`UsosCredentials` is keyed by school slug, `capabilities()` is probed per installation) rather than
discovered later by a client that assumed one endpoint and one key.

Three things a first implementation usually gets wrong, recorded because each one is expensive:

* **It is OAuth 1.0a, not OAuth 2.** Request-token → authorize → access-token, with every call
  signed HMAC-SHA1. A modern OAuth 2 client library does not merely need adapting; it does not
  apply. This is the single reason the three consumer providers in `providers.py` share no code
  with this file.
* **Scopes are granular and requested up front.** `studies` does not include `grades`. What is not
  asked for at authorization time cannot be fetched later without sending the user round again.
* **Installations genuinely differ.** Methods present at one university are absent at another, so
  capabilities are probed rather than assumed.

On grades specifically, there is a real tension worth stating rather than silently resolving.
LAUNCHCHECKLIST §3a says grades "are not [needed], and must never be requested", on the grounds that
asking for more than is used is both a privacy failure and a reason for a university to refuse the
registration. The requested feature is that a person *may* transfer their diploma and transcript if
they want to. Both hold, and the resolution is that they are **two different authorizations**:
`BASE_SCOPES` is what a normal connection asks for, and grades are only ever added by an explicit,
separate act by the account holder (`GRADES_SCOPE`). The registration request to each university
should then say exactly that — an optional, user-initiated scope, not part of the default grant.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Protocol

from django.conf import settings

from .models import GradeScale, School, StudentStatus

# --- the wire vocabulary, recorded as data ------------------------------------------------------
# Kept here so the whole dependency surface is reviewable in one place against the published USOS
# API documentation, instead of being spelled out at the call sites that use it.
METHODS = {
    'request_token': 'services/oauth/request_token',
    'authorize': 'services/oauth/authorize',
    'access_token': 'services/oauth/access_token',
    'user': 'services/users/user',
    'programmes': 'services/progs/student',
    'terms': 'services/grades/terms',
    'theses': 'services/theses/user',
    'installation': 'services/apisrv/installation',
}

#: The `fields=` selector USOS requires — it returns nothing useful without one.
USER_FIELDS = 'id|first_name|last_name|student_number|email|student_status'

#: Identity and enrolment. This is what an ordinary connection asks for, and no more.
BASE_SCOPES: tuple[str, ...] = ('studies',)
#: Never in the default grant. Added only when the account holder explicitly asks to transfer a
#: transcript — see this module's own header for why that distinction is load-bearing.
GRADES_SCOPE = 'grades'
#: What makes a token outlive the browser session. Only worth requesting once there is somewhere
#: safe to keep the result; see `EducationProfile`'s note on why no token column exists yet.
OFFLINE_SCOPE = 'offline_access'


@dataclass(frozen=True)
class UsosCredentials:
    """One institution's consumer key. There is deliberately no global fallback."""

    school_slug: str
    base_url: str
    consumer_key: str
    consumer_secret: str


@dataclass(frozen=True)
class UsosCapabilities:
    """What a given installation will actually answer, probed rather than assumed."""

    supports_identity: bool = False
    supports_studies: bool = False
    supports_grades: bool = False
    supports_diplomas: bool = False


@dataclass(frozen=True)
class UsosSession:
    """A connected link, as far as the rest of the app is concerned.

    Carries no token on purpose — see `EducationProfile`. A real implementation resolves the token
    from a secret store keyed by (user, school) at call time.
    """

    school_slug: str
    scopes: tuple[str, ...]
    user_id: str
    first_name: str = ''
    last_name: str = ''
    student_number: str = ''
    student_status: int | None = None


@dataclass(frozen=True)
class UsosProgramme:
    name: str
    level: str = ''
    year: int | None = None


@dataclass(frozen=True)
class UsosGrade:
    code: str
    name: str
    term: str
    ects: int
    value: str
    scale: str = GradeScale.POLISH_2_5


@dataclass(frozen=True)
class UsosDiploma:
    title: str
    level: str = ''
    programme: str = ''
    issued_on: str = ''
    final_grade: str = ''
    source_id: str = ''


class UsosConnector(Protocol):
    """The seam. `active_connector()` is the one line a real client replaces."""

    def credentials_for(self, school: School) -> UsosCredentials | None: ...

    def capabilities(self, school: School) -> UsosCapabilities: ...

    def connect(self, school: School, scopes: tuple[str, ...], user) -> UsosSession | None: ...

    def fetch_programmes(self, session: UsosSession) -> list[UsosProgramme]: ...

    def fetch_grades(self, session: UsosSession) -> list[UsosGrade]: ...

    def fetch_diplomas(self, session: UsosSession) -> list[UsosDiploma]: ...


class UnconfiguredUsosConnector:
    """The real state of this integration, expressed as an object rather than a comment.

    Every method reports that nothing is available, because nothing is: no institution has issued
    EdMat a consumer key. This is the default so that a half-finished deployment cannot accidentally
    appear to verify anybody, and so the UI's "current state" panel is reading a live answer rather
    than a hardcoded sentence.
    """

    def credentials_for(self, school: School) -> UsosCredentials | None:
        configured = getattr(settings, 'EDMAT_USOS_CREDENTIALS', {}).get(school.slug)
        if not configured or not school.usos_base_url:
            return None
        return UsosCredentials(
            school_slug=school.slug,
            base_url=school.usos_base_url,
            consumer_key=configured['consumer_key'],
            consumer_secret=configured['consumer_secret'],
        )

    def capabilities(self, school: School) -> UsosCapabilities:
        return UsosCapabilities()

    def connect(self, school: School, scopes: tuple[str, ...], user) -> UsosSession | None:
        return None

    def fetch_programmes(self, session: UsosSession) -> list[UsosProgramme]:
        return []

    def fetch_grades(self, session: UsosSession) -> list[UsosGrade]:
        return []

    def fetch_diplomas(self, session: UsosSession) -> list[UsosDiploma]:
        return []


# --- the mock ----------------------------------------------------------------------------------
# Its purpose is not to fake a feature for a demo. It exists so the ground laid here — the consent
# model, the import path, the course matching, the standing calculation — is genuinely exercised by
# the test suite against the same interface a real client will implement, instead of being
# plausible-looking code nobody has ever run. It is off unless explicitly switched on.

_PROGRAMMES = [
    ('Matematyka', 'undergraduate'),
    ('Informatyka', 'undergraduate'),
    ('Fizyka', 'undergraduate'),
    ('Matematyka stosowana', 'graduate'),
]

#: Academic years the mock transcript spans, oldest first. **Fixed strings rather than derived from
#: today's date**, deliberately: a mock whose output moves with the clock makes every test that
#: asserts on a term name fail on some future run for no reason anybody would connect to a code
#: change. Three years is also the honest shape of the thing — a real Polish undergraduate transcript
#: is six semesters, not one, and the whole point of grouping by year is that there is more than one
#: year to group.
_ACADEMIC_YEARS = ('2022/23', '2023/24', '2024/25')

#: `(code, name, ects, year_index, semester)` — `year_index` indexes `_ACADEMIC_YEARS`, and the
#: semester is USOS's own suffix convention: `Z` for zimowy (winter), `L` for letni (summer). Spread
#: across all three years on purpose rather than generated from the list position, because a real
#: curriculum front-loads the big foundational courses and puts the electives late, and a transcript
#: whose years all look identical would hide exactly the differences a per-year view exists to show.
_COURSES = [
    ('1000-211bAM1', 'Analiza matematyczna I', 10, 0, 'Z'),
    ('1000-212bAL1', 'Algebra liniowa z geometrią I', 8, 0, 'Z'),
    ('1000-213bWDP', 'Wstęp do programowania', 6, 0, 'Z'),
    ('1000-211bAM2', 'Analiza matematyczna II', 10, 0, 'L'),
    ('1000-212bAL2', 'Algebra liniowa z geometrią II', 8, 0, 'L'),
    ('1000-214bRP', 'Rachunek prawdopodobieństwa', 6, 1, 'Z'),
    ('1000-215bTM', 'Topologia', 5, 1, 'Z'),
    ('1100-1IND12', 'Mechanika klasyczna', 9, 1, 'L'),
    ('1000-216bSTAT', 'Statystyka matematyczna', 6, 1, 'L'),
    ('1000-217bRRZ', 'Równania różniczkowe zwyczajne', 7, 2, 'Z'),
    ('1000-218bAF', 'Analiza funkcjonalna', 6, 2, 'Z'),
    ('1000-219bSEM', 'Seminarium licencjackie', 4, 2, 'L'),
]

_GRADES = ['3.0', '3.5', '4.0', '4.5', '5.0']


def _seed(*parts: str) -> int:
    return int(hashlib.sha256('|'.join(parts).encode()).hexdigest()[:8], 16)


class MockUsosConnector:
    """A stand-in that behaves like the real API in the ways that matter.

    Two of those matter a great deal and are easy to get wrong in a mock:

    * **It respects granted scopes.** Connecting with `studies` alone and then asking for grades
      returns nothing, exactly as USOS would — so a UI bug that forgets to request the scope fails
      here rather than in production.
    * **It reports capabilities per installation**, so a school with no USOS deployment is
      genuinely unsupported rather than uniformly pretending.
    """

    def credentials_for(self, school: School) -> UsosCredentials | None:
        if not school.usos_base_url:
            return None
        return UsosCredentials(
            school_slug=school.slug,
            base_url=school.usos_base_url,
            consumer_key='mock-consumer-key',
            consumer_secret='mock-consumer-secret',
        )

    def capabilities(self, school: School) -> UsosCapabilities:
        if not school.runs_usos:
            return UsosCapabilities()
        return UsosCapabilities(
            supports_identity=True,
            supports_studies=True,
            supports_grades=True,
            # Thesis/diploma records are the least uniformly deployed of the four across real
            # installations, so the mock varies it rather than implying every university answers.
            supports_diplomas=school.country == 'PL',
        )

    def connect(self, school: School, scopes: tuple[str, ...], user) -> UsosSession | None:
        if not self.capabilities(school).supports_identity:
            return None
        seed = _seed(school.slug, str(user.pk))
        name = (getattr(user, 'first_name', '') or user.username).split()[0]
        return UsosSession(
            school_slug=school.slug,
            scopes=tuple(scopes),
            user_id=f'{seed % 900000 + 100000}',
            first_name=name.capitalize(),
            last_name=(getattr(user, 'last_name', '') or 'Kowalski'),
            student_number=f'{seed % 400000 + 300000}',
            student_status=2,
        )

    def fetch_programmes(self, session: UsosSession) -> list[UsosProgramme]:
        if 'studies' not in session.scopes:
            return []
        name, level = _PROGRAMMES[_seed(session.user_id, 'prog') % len(_PROGRAMMES)]
        return [UsosProgramme(name=name, level=level, year=_seed(session.user_id, 'yr') % 3 + 1)]

    def fetch_grades(self, session: UsosSession) -> list[UsosGrade]:
        """The whole transcript, across every year of it.

        A real `services/grades/terms` call returns results per term and a full degree spans six of
        them, so a mock that only ever produced one academic year would leave the entire "which years
        do I want to transfer?" question untestable — and that question is the reason the import path
        takes a term filter at all (`UsosImportView`).
        """
        if GRADES_SCOPE not in session.scopes:
            return []
        out: list[UsosGrade] = []
        for code, name, ects, year_index, semester in _COURSES:
            value = _GRADES[_seed(session.user_id, code) % len(_GRADES)]
            out.append(
                UsosGrade(
                    code=code,
                    name=name,
                    term=f'{_ACADEMIC_YEARS[year_index]}-{semester}',
                    ects=ects,
                    value=value,
                )
            )
        return out

    def fetch_diplomas(self, session: UsosSession) -> list[UsosDiploma]:
        if 'studies' not in session.scopes:
            return []
        programme = self.fetch_programmes(session)
        title = programme[0].name if programme else 'Matematyka'
        return [
            UsosDiploma(
                title=f'Licencjat — {title}',
                level='undergraduate',
                programme=title,
                issued_on='2024-07-05',
                final_grade=_GRADES[_seed(session.user_id, 'dip') % len(_GRADES)],
                source_id=f'dip-{session.user_id}',
            )
        ]


def active_connector() -> UsosConnector:
    """The one line a real OAuth 1.0a client replaces.

    Deliberately a lookup rather than a module-level singleton, so a test can switch it with
    `override_settings` and so no import-time decision freezes it.
    """
    if getattr(settings, 'EDMAT_USOS_MOCK', False):
        return MockUsosConnector()
    return UnconfiguredUsosConnector()


def integration_state(school: School | None = None) -> dict:
    """The current state of the USOS connection, for the UI's own state panel."""
    connector = active_connector()
    configured_schools = sorted(getattr(settings, 'EDMAT_USOS_CREDENTIALS', {}).keys())
    caps = connector.capabilities(school) if school else UsosCapabilities()
    return {
        'protocol': 'OAuth 1.0a (HMAC-SHA1, three-legged)',
        'is_mock': isinstance(connector, MockUsosConnector),
        'configured_schools': configured_schools,
        'base_scopes': list(BASE_SCOPES),
        'grades_scope': GRADES_SCOPE,
        'methods': METHODS,
        'school': school.slug if school else None,
        'school_runs_usos': bool(school and school.runs_usos),
        'capabilities': {
            'identity': caps.supports_identity,
            'studies': caps.supports_studies,
            'grades': caps.supports_grades,
            'diplomas': caps.supports_diplomas,
        },
        'blockers': _blockers(school),
        'grants': [
            'Verified enrolment, from the registry rather than from anything the visitor typed.',
            'A capability ceiling of S — full participation without waiting to earn it '
            '(LAUNCHCHECKLIST §3).',
            'Moderation authority over other people\'s work: none. Being a real student is an '
            'identity claim, not evidence of judgement (§2b).',
            'Vote weight: none until reputation is actually earned (§2c).',
            'Optionally, and only if asked for separately: a diploma and a transcript, which map '
            'onto real branches on this site.',
        ],
    }


def _blockers(school: School | None) -> list[str]:
    out: list[str] = []
    connector = active_connector()
    if isinstance(connector, MockUsosConnector):
        out.append(
            'This deployment is running the mock connector (EDMAT_USOS_MOCK). It exercises the '
            'import and consent paths end to end but talks to no university.'
        )
        return out
    if school and not school.runs_usos:
        out.append(f'{school.short_name} runs no USOS installation, so there is nothing to connect to.')
    out.append(
        'No consumer key. USOS API credentials are issued per institution, by that institution, to '
        'a named application, after a request a person there approves — so this is a rollout per '
        'university rather than one integration, and it should be started early.'
    )
    out.append(
        'The client itself is unwritten: OAuth 1.0a with HMAC-SHA1 signing and a three-legged '
        'token exchange, which no OAuth 2 library provides.'
    )
    out.append(
        'Nowhere safe to keep an access token. A token carrying offline_access is a long-lived '
        'credential to somebody\'s academic record and needs an encrypted store, not a column in '
        'the SQLite file.'
    )
    return out


def status_from_usos(code: int | None) -> str:
    """USOS reports 2 = active student, 1 = inactive/alumnus, 0 = not a student (e.g. staff)."""
    return {2: StudentStatus.STUDENT, 1: StudentStatus.ALUMNUS, 0: StudentStatus.STAFF}.get(
        code, StudentStatus.UNKNOWN
    )
