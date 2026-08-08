"""Endpoints for the sign-in drafts, the school list, and the education/USOS ground.

Two things worth noticing about the shape here.

**The provider and USOS "state" endpoints are the honest half of the feature, not filler.** The
frontend's connection modal renders from them, so what a visitor is told about a connection is
computed from the same settings a real client would read. Configure a client id and the modal stops
calling it a draft on its own; nobody has to remember to edit a paragraph.

**Nothing here signs anybody in.** There is no mock handshake and no bypass: the sign-in providers
are drafts, and a draft that quietly authenticated people would be a considerably worse thing than
an honest button. Real sign-in stays where it already is — `accounts.LoginView`.
"""

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import providers, services, usos
from .models import EducationProfile, School, Verification, academic_year_of
from .serializers import EducationProfileSerializer, SchoolSerializer
from .standing import ceiling_for


def _profile_for(user) -> EducationProfile:
    profile, _created = EducationProfile.objects.get_or_create(user=user)
    return profile


class ProviderStateView(APIView):
    """GET /api/auth/providers/ — every sign-in template and exactly how far it is."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(
            {
                'providers': providers.all_states(),
                # The one link the modal needs: this is a draft, and the repository is where the
                # rest of the reasoning lives.
                'repository_url': providers.settings_repository_url(),
            }
        )


class SchoolListView(APIView):
    """GET /api/schools/ — the institutions offered in the school picker.

    Deliberately open: which universities a study site knows about is not private, and the register
    form needs it before anybody has an account.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        qs = School.objects.filter(is_active=True)
        query = request.query_params.get('q', '').strip().lower()
        if query:
            qs = [s for s in qs if query in s.name.lower() or query in s.short_name.lower()]
        return Response({'schools': SchoolSerializer(qs, many=True).data})


class EducationView(APIView):
    """GET/PATCH /api/education/me/ — the account holder's own education claim and consents."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        profile = _profile_for(request.user)
        return Response(self._payload(request, profile))

    def patch(self, request):
        profile = _profile_for(request.user)
        data = request.data

        if 'school' in data:
            slug = (data.get('school') or '').strip()
            new_school = School.objects.filter(slug=slug, is_active=True).first() if slug else None
            changed = (new_school.pk if new_school else None) != (
                profile.school_id if profile.school_id else None
            )
            profile.school = new_school
            if new_school:
                profile.other_school_name = ''
            if changed:
                # Changing the declared institution drops every claim the previous one backed. It
                # is no longer a statement that institution made, and carrying a verification
                # across a school change is precisely how a verified badge would become
                # meaningless.
                self._reset_claims(profile)

        if 'other_school_name' in data:
            name = (data.get('other_school_name') or '').strip()[:200]
            if name:
                profile.school = None
                self._reset_claims(profile)
            profile.other_school_name = name

        if 'programme' in data:
            profile.programme = (data.get('programme') or '').strip()[:200]

        for flag in ('share_school', 'share_diploma', 'share_grades'):
            if flag in data:
                setattr(profile, flag, bool(data[flag]))

        profile.save()
        return Response(self._payload(request, profile))

    @staticmethod
    def _reset_claims(profile: EducationProfile) -> None:
        profile.clear_usos()
        profile.verification = Verification.SELF_DECLARED
        profile.verified_at = None
        profile.verified_via = ''
        profile.diplomas.all().delete()
        profile.grades.all().delete()

    @staticmethod
    def _payload(request, profile: EducationProfile) -> dict:
        return {
            'education': EducationProfileSerializer(profile).data,
            'standing': ceiling_for(profile, request.user),
            'usos': usos.integration_state(profile.school),
            # An address on the institution's domain is NOT counted as verification here, and this
            # flag is how the UI explains why. EdMat has no email-confirmation flow yet, so an
            # unconfirmed address is something the account holder typed — and a verification that
            # can be earned by typing is worth exactly as much to somebody lying. It becomes real
            # the day addresses are confirmed, and not before.
            'school_email_eligible': bool(
                profile.school and profile.school.matches_email(request.user.email or '')
            ),
        }


class UsosStateView(APIView):
    """GET /api/education/usos/ — the current state of the USOS integration, per institution."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        slug = request.query_params.get('school', '').strip()
        school = School.objects.filter(slug=slug).first() if slug else None
        return Response(usos.integration_state(school))


class UsosConnectView(APIView):
    """POST /api/education/usos/connect/ — attempt a connection; DELETE — disconnect.

    With no consumer key issued (the real state today) this returns 503 together with the full
    list of what is missing, rather than a bare failure: the caller is a UI whose entire job at that
    moment is to explain the state.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        profile = _profile_for(request.user)
        if profile.school is None:
            return Response(
                {'detail': 'Pick your institution first — USOS is a per-university system.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Grades are never part of the default grant. They are added only when the account holder
        # explicitly asks to transfer a transcript, which is a separate authorization at the
        # university — see identity/usos.py's header for why that distinction is load-bearing.
        connected = services.connect_usos(
            profile, request.user, include_grades=bool(request.data.get('include_grades'))
        )
        if not connected:
            return Response(
                usos.integration_state(profile.school), status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        return Response(EducationView._payload(request, profile))

    def delete(self, request):
        profile = _profile_for(request.user)
        profile.clear_usos()
        profile.save()
        return Response(EducationView._payload(request, profile))


class UsosImportView(APIView):
    """POST /api/education/usos/import/ — transfer a diploma or a transcript, on request.

    Importing is not publishing. Nothing here touches a single consent flag, so a transcript pulled
    in stays private until the account holder separately says otherwise.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        profile = _profile_for(request.user)
        if not profile.usos_connected or profile.school is None:
            return Response(
                {'detail': 'Connect USOS first.'}, status=status.HTTP_400_BAD_REQUEST
            )

        kind = request.data.get('kind')
        if kind not in {'diploma', 'grades'}:
            return Response({'detail': 'kind must be "diploma" or "grades".'}, status=400)

        if kind == 'diploma':
            imported = services.import_diplomas(profile)
        else:
            if usos.GRADES_SCOPE not in profile.usos_scopes:
                # Not an error to hide: the scope genuinely was not granted, and the honest answer
                # is that reconnecting is what fixes it, not a retry.
                return Response(
                    {
                        'detail': 'The grades scope was not granted. Reconnect and ask for it '
                        'explicitly — it is deliberately not part of the default authorization.',
                        'needs_scope': usos.GRADES_SCOPE,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            # An optional narrowing to specific academic years — see `services.import_grades` for
            # what "these years" and "my transcript" each mean for what gets deleted. Validated here
            # rather than there because the shape of a request body is this layer's business: the
            # service takes a real list of strings, and turning whatever arrived into one — or
            # refusing it in the API's own error shape — is what a boundary is for.
            years = request.data.get('years')
            if years is not None and (
                not isinstance(years, list) or any(not isinstance(y, str) for y in years)
            ):
                return Response(
                    {'years': ['Expected a list of academic years, e.g. ["2023/24"].']},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            imported = services.import_grades(profile, years)

        payload = EducationView._payload(request, profile)
        payload['imported'] = imported
        return Response(payload)


class ImportedGradesView(APIView):
    """DELETE /api/education/grades/[?year=2023/24] — remove an imported transcript, or one year of it.

    Distinct from switching the consent off: one hides it, this deletes it. Somebody who imported a
    transcript and changed their mind should be able to take it back rather than merely un-tick it.

    **`?year=` is not a convenience wrapper around the same operation, and the consent flag is why.**
    Removing everything leaves nothing to share, so `share_grades` is turned off with it — leaving a
    consent switched on over an empty record would be a promise about data that no longer exists.
    Removing ONE year leaves the rest, so the flag is deliberately untouched: the person still wants
    the years they kept to be visible, and silently un-publishing them because they pruned a different
    year would be the app overruling a decision they made separately.

    A `year` that matches nothing is a **404**, not a cheerful no-op. The caller is a UI that will
    otherwise tell somebody their first year has been deleted when it has not.
    """

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        profile = _profile_for(request.user)
        year = (request.query_params.get('year') or '').strip()

        if year and not any(academic_year_of(g.term) == year for g in profile.grades.all()):
            return Response(
                {'detail': f'No imported results for {year}.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        removed = services.remove_grades(profile, year)
        payload = EducationView._payload(request, profile)
        payload['removed'] = removed
        return Response(payload)
