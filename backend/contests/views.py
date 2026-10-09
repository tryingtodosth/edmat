"""The contests API (CONTESTS-BRIEF.md §3.A).

**Three rules shape every handler here and are worth stating once:**

1. **Visibility is the queryset filter; authority is an object-level check; you need both**
   (house rule 4). `get_queryset` scopes through `access.visible_contests`, so a stranger poking at
   a draft gets 404 — for them it does not exist, which is the honest answer as well as the safe
   one. But a filter never runs for an action that arrives with an id in the URL, so every
   `@action` asks `access` or `rules` explicitly before it mutates anything.
2. **A refusal carries its word** (house rule 6). `{"detail": "<word>"}` with 403 for "you may
   not", 409 for "the world moved" (already announced, already published, the last organiser) and
   400 for "this request is malformed". `labels.ts: CONTEST_BLOCK_LABELS` has one sentence per word.
3. **Nothing here re-derives a rule.** `rules.py` answers every "may this", `access.py` every "can
   this person see it", `presets.py` is data, `compliance.py` builds the panel. A viewset that
   re-implemented one of them is how two surfaces start disagreeing (root `CLAUDE.md` boundary 2).

Nested ids inside an `@action`'s `url_path` interpolate `NUMERIC_PK_REGEX`
(`config/routers.py`): `/api/contests/50/certificate/undefined/` is a 404, not the 500 that
`.filter(pk='undefined')` raises.
"""

from django.db import IntegrityError, transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from config.creation import creation_block_reason
from config.routers import NUMERIC_PK_REGEX
from moderation.permissions import feature_gate

from . import access, compliance, people, personalize, presets, rules
from .models import (
    CERTIFIABLE_TITLES,
    Contest,
    ContestComplaint,
    ContestProblem,
    ContestRegistration,
    ContestRulesSection,
    ContestStaff,
    ContestStage,
    ContestSubmission,
)
from .serializers import (
    ComplaintAnswerSerializer,
    ContestComplaintSerializer,
    ContestListSerializer,
    ContestProblemSerializer,
    ContestRegistrationSerializer,
    ContestResultSerializer,
    ContestRulesSectionSerializer,
    ContestRulesVersionSerializer,
    ContestScoreSerializer,
    ContestSerializer,
    ContestStaffSerializer,
    ContestStageSerializer,
    ContestSubmissionSerializer,
    DecideSerializer,
    PublishNameSerializer,
    RegisterSerializer,
    ScoresWriteSerializer,
    SubmissionWriteSerializer,
    TransitionSerializer,
    _registration_numbers,
)

_Gate = feature_gate('contests')


def _refuse(word, code=status.HTTP_403_FORBIDDEN):
    return Response({'detail': word}, status=code)


class ContestPresetsView(APIView):
    """`GET /api/contest-presets/` — the presets a founder may start from, in the order the wizard
    shows them. Public, because the list is also what `/about/contests` explains; behind the flag
    like everything else here."""

    permission_classes = [permissions.AllowAny, _Gate]

    def get(self, request):
        return Response(presets.as_api(request.user))


class PeopleSuggestionsView(APIView):
    """`GET /api/contests/people-suggestions/` — "prefilling with current users" (`people.py`).

    A separate `APIView` rather than a list-level `@action` on the viewset, because it is not about
    a contest at all: it answers "who do you already work with" for somebody who has not founded
    anything yet, which is exactly when the wizard asks.
    """

    permission_classes = [permissions.IsAuthenticated, _Gate]

    def get(self, request):
        return Response({'people': people.suggested_people(request.user)})


class ContestViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _Gate]
    serializer_class = ContestSerializer

    _PREFETCH = ('staff__user__profile', 'stages__problems', 'registrations__user__profile')

    def get_queryset(self):
        qs = (
            Contest.objects.select_related('organiser__profile', 'organization')
            .prefetch_related(*self._PREFETCH)
        )
        qs = access.visible_contests(self.request.user, qs)
        params = self.request.query_params
        if params.get('mine') in ('1', 'true'):
            user = self.request.user
            if not user.is_authenticated:
                return qs.none()
            from django.db.models import Q

            qs = qs.filter(
                Q(organiser=user) | Q(staff__user=user) | Q(registrations__user=user)
            ).distinct()
        if params.get('status'):
            qs = qs.filter(status__in=[s for s in params['status'].split(',') if s])
        if params.get('preset'):
            qs = qs.filter(preset_key__in=[p for p in params['preset'].split(',') if p])
        if params.get('q'):
            qs = qs.filter(title__icontains=params['q'])
        return qs.order_by('-created_at', '-id')

    def get_serializer_class(self):
        return ContestListSerializer if self.action == 'list' else ContestSerializer

    def _contest(self) -> Contest:
        """The object-level half of house rule 4: the detail queryset is already scoped, so this is
        a 404 for anybody who cannot see it, and the single place every action starts."""
        return get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])

    def _manageable(self):
        contest = self._contest()
        if not access.can_manage(self.request.user, contest):
            return None, _refuse(rules.NOT_MANAGER)
        return contest, None

    # ---- create: the gate, the preset, and the personalisation report ------------------------
    def create(self, request, *args, **kwargs):
        """`POST /api/contests/`.

        Founding a contest promises a prize to strangers under KC art. 919–921, which is the most
        consequential founding act on this site — so it asks the same creation gate the other four
        do (`config/creation.py`), and answers `403 {"detail": word}` exactly as they do.

        The response carries `personalisation`: what `personalize.apply_preset` created on the new
        contest node — a plan, a goal, the legal-checklist tasks, the "jury member wanted" needs,
        the jury's confirmation poll — and, honestly, what it SKIPPED. On step A's own branch that
        report says `not_built`, because the body is step B's; the wizard shows whatever it says
        rather than a promise (house rule 10).
        """
        reason = creation_block_reason(request.user, 'contest')
        if reason:
            return _refuse(reason)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        contest = serializer.save(organiser=request.user)
        self._apply_preset_defaults(contest)
        report = personalize.apply_preset(contest, request.user)
        data = ContestSerializer(contest, context=self.get_serializer_context()).data
        data['personalisation'] = report
        return Response(data, status=status.HTTP_201_CREATED)

    def _apply_preset_defaults(self, contest: Contest):
        """Copy the preset's own defaults onto the row, and lay out the regulamin's empty sections.

        The wizard sends what the founder edited; these are the fields it does not ask about because
        the preset decides them — the complaint window (14, or 7 for the two kurator presets), the
        publication default, whether minors may enter, whether it is a team contest. Written here
        rather than as model defaults because they are the PRESET's answers, not the app's.
        """
        preset = presets.get(contest.preset_key)
        if preset is None:
            return
        changed = []
        for field, value in (
            ('complaint_window_days', preset.complaint_window_days),
            ('publication_default', preset.publication_default),
            ('prize_regime', preset.prize_regime if contest.has_prize else 'none'),
        ):
            if not self.request.data.get(field):
                setattr(contest, field, value)
                changed.append(field)
        if 'allows_minors' not in self.request.data:
            contest.allows_minors = preset.allows_minors
            changed.append('allows_minors')
        if 'team' not in self.request.data:
            contest.team = preset.team
            changed.append('team')
        if 'audience' not in self.request.data:
            contest.audience = preset.audience
            changed.append('audience')
        if changed:
            contest.save(update_fields=changed + ['updated_at'])
        # The regulamin's skeleton: one empty section per paragraph the preset requires, in order,
        # so the editor opens on the twelve headings with their guidance rather than on a blank box.
        existing = set(contest.rules_sections.values_list('key', flat=True))
        rows = [
            ContestRulesSection(contest=contest, key=section.key, order=order, body='')
            for order, section in enumerate(presets.sections_for(preset))
            if section.key not in existing
        ]
        if rows:
            ContestRulesSection.objects.bulk_create(rows)
        # The stage ladder. Dates come from the preset's offsets against `starts_at`, which is
        # exactly what the wizard shows and lets the founder edit afterwards.
        if not contest.stages.exists():
            self._lay_out_stages(contest, preset)

    def _lay_out_stages(self, contest: Contest, preset):
        from datetime import timedelta

        base = contest.starts_at
        rows = []
        for order, template in enumerate(preset.stages):
            opens_at = base + timedelta(days=template.offset_days) if base else None
            closes_at = (
                opens_at + timedelta(days=template.duration_days) if opens_at else None
            )
            rows.append(ContestStage(
                contest=contest,
                order=order,
                key=template.key,
                title=template.name_pl,
                mode='onsite' if template.mode == 'onsite' else 'online',
                opens_at=opens_at,
                closes_at=closes_at,
                advancement=template.advancement,
            ))
        for row in rows:
            row.save()

    def update(self, request, *args, **kwargs):
        contest, refusal = self._manageable()
        if refusal:
            return refusal
        serializer = self.get_serializer(contest, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """A draft nobody has been told about deletes; anything announced is cancelled instead
        (house rule 12). `transition` is the way to cancel, and this says so with a word rather
        than silently doing something else."""
        contest, refusal = self._manageable()
        if refusal:
            return refusal
        if contest.status != 'draft':
            return _refuse(rules.ILLEGAL_TRANSITION, status.HTTP_409_CONFLICT)
        contest.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ---- the lifecycle ------------------------------------------------------------------------
    @action(detail=True, methods=['post'])
    def announce(self, request, pk=None):
        contest, refusal = self._manageable()
        if refusal:
            return refusal
        reason = rules.announce_block_reason(contest)
        if reason:
            # 409: every one of these words means "the world is not ready", not "your request was
            # malformed" — except `illegal_transition`, which also means the world moved.
            return _refuse(reason, status.HTTP_409_CONFLICT)
        rules.transition(contest, 'announced', actor=request.user)
        return Response(ContestSerializer(contest, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'])
    def transition(self, request, pk=None):
        contest, refusal = self._manageable()
        if refusal:
            return refusal
        payload = TransitionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        to = payload.validated_data['status']
        if to == 'results_published':
            return _refuse(rules.ILLEGAL_TRANSITION, status.HTTP_400_BAD_REQUEST)
        reason = rules.transition_block_reason(contest, to)
        if reason:
            return _refuse(reason, status.HTTP_409_CONFLICT)
        rules.transition(contest, to, actor=request.user)
        return Response(ContestSerializer(contest, context=self.get_serializer_context()).data)

    # ---- staff --------------------------------------------------------------------------------
    @action(detail=True, methods=['get', 'post'])
    def staff(self, request, pk=None):
        contest = self._contest()
        if request.method == 'GET':
            if not access.is_staff(request.user, contest):
                # Who is on the jury is public once the contest is announced — KC art. 921 §2 wants
                # them named in the regulamin — so this is not a leak. Before then it is the draft's
                # own business.
                if contest.status == 'draft':
                    raise Http404
            rows = contest.staff.select_related('user__profile')
            return Response(ContestStaffSerializer(rows, many=True).data)
        if not access.can_manage(request.user, contest):
            return _refuse(rules.NOT_MANAGER)
        payload = ContestStaffSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            # The insert gets its OWN savepoint, which is the whole reason for the `atomic()`:
            # catching an IntegrityError without one leaves the surrounding transaction broken, and
            # the very next query answers `TransactionManagementError` — a 500 on a request whose
            # honest answer is 409 (`backend/CLAUDE.md`, SQLite rule 3; found by this app's own test).
            with transaction.atomic():
                row = ContestStaff.objects.create(
                    contest=contest,
                    user_id=payload.validated_data['user_id'],
                    role=payload.validated_data.get('role', 'jury'),
                    added_by=request.user,
                )
        except IntegrityError:
            # One row per person (`contests_one_role_per_person`). Already on the staff is the
            # world having moved, not a malformed request.
            return _refuse('already_staff', status.HTTP_409_CONFLICT)
        return Response(ContestStaffSerializer(row).data, status=status.HTTP_201_CREATED)

    # ---- stages -------------------------------------------------------------------------------
    @action(detail=True, methods=['get', 'post'])
    def stages(self, request, pk=None):
        contest = self._contest()
        if request.method == 'GET':
            rows = contest.stages.prefetch_related('problems', 'submissions').select_related('event')
            return Response(ContestStageSerializer(rows, many=True, context={'request': request}).data)
        if not access.can_manage(request.user, contest):
            return _refuse(rules.NOT_MANAGER)
        preset = presets.get(contest.preset_key)
        if preset is not None and preset.stages_locked:
            # The olimpiada's three stages are the 2002 regulation's and may not be edited here
            # (`menis_2002_olimp`). A refusal with a word, not a disabled button only.
            return _refuse('stages_locked', status.HTTP_409_CONFLICT)
        payload = ContestStageSerializer(data=request.data, context={'request': request})
        payload.is_valid(raise_exception=True)
        order = payload.validated_data.get('order')
        if order is None:
            order = contest.stages.count()
        stage = payload.save(contest=contest, order=order)
        return Response(
            ContestStageSerializer(stage, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    # ---- registrations ------------------------------------------------------------------------
    @action(detail=True, methods=['get', 'post'])
    def registrations(self, request, pk=None):
        contest = self._contest()
        if request.method == 'GET':
            if not access.is_staff(request.user, contest):
                # The roster is the contest's inside: who entered, their school, their guardian's
                # name. A participant sees their own row on the contest payload (`my_registration`).
                return _refuse(rules.NOT_STAFF)
            rows = contest.registrations.select_related('user__profile')
            context = {'request': request, 'registration_numbers': _registration_numbers(contest)}
            return Response(ContestRegistrationSerializer(rows, many=True, context=context).data)

        payload = RegisterSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        reason = rules.register_block_reason(request.user, contest, data)
        if reason:
            code = (
                status.HTTP_409_CONFLICT
                if reason in (rules.ALREADY_REGISTERED, rules.FULL, rules.NOT_OPEN)
                else status.HTTP_403_FORBIDDEN
            )
            return _refuse(reason, code)
        row, _created = ContestRegistration.objects.get_or_create(
            contest=contest, user=request.user
        )
        row.status = 'requested'
        row.affiliation = data.get('affiliation', '')
        row.guardian_name = data.get('guardian_name', '')
        row.guardian_consent_at = timezone.now() if data.get('guardian_consent') else None
        row.publish_name = bool(data.get('publish_name'))
        row.team_name = data.get('team_name', '')
        row.accepted_rules_version = contest.rules_version
        row.decided_by = None
        row.decided_at = None
        row.save()
        context = {'request': request, 'registration_numbers': _registration_numbers(contest)}
        return Response(
            ContestRegistrationSerializer(row, context=context).data,
            status=status.HTTP_201_CREATED,
        )

    # ---- results ------------------------------------------------------------------------------
    @action(detail=True, methods=['post'], url_path='publish-results')
    def publish_results(self, request, pk=None):
        contest, refusal = self._manageable()
        if refusal:
            return refusal
        reason = rules.publish_results_block_reason(contest)
        if reason:
            return _refuse(reason, status.HTTP_409_CONFLICT)
        rules.publish_results(contest, actor=request.user)
        return Response(ContestSerializer(contest, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], url_path='unpublish-results')
    def unpublish_results(self, request, pk=None):
        contest, refusal = self._manageable()
        if refusal:
            return refusal
        reason = rules.unpublish_block_reason(contest)
        if reason:
            return _refuse(reason, status.HTTP_409_CONFLICT)
        rules.unpublish_results(contest, actor=request.user)
        return Response(ContestSerializer(contest, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['get'])
    def results(self, request, pk=None):
        """The published ranking. Public once published, because that is what publishing means;
        empty (not 403) before, because "there are no results yet" is the true answer and a refusal
        would make a page have to guess."""
        contest = self._contest()
        rows = contest.results.select_related('registration__user__profile')
        context = {
            'request': request,
            'registration_numbers': _registration_numbers(contest),
        }
        return Response({
            'published_at': contest.results_published_at,
            'complaints_close_at': contest.complaints_close_at,
            'complain_block_reason': rules.complain_block_reason(request.user, contest),
            'results': ContestResultSerializer(rows, many=True, context=context).data,
        })

    @action(detail=True, methods=['get'])
    def ranking(self, request, pk=None):
        """The LIVE, recounted ranking — staff only before results are published, everyone after
        (at which point it is the same thing the frozen rows say, computed the long way)."""
        contest = self._contest()
        if contest.results_published_at is None and not access.is_staff(request.user, contest):
            return _refuse(rules.NOT_STAFF)
        rows = rules.titles_for(rules.ranking(contest), contest)
        numbers = _registration_numbers(contest)
        return Response({'rows': [
            {
                'rank': row['rank'],
                'registration': row['registration'].pk,
                'number': numbers.get(row['registration'].pk, 0),
                'total_points': row['total_points'],
                'max_points': row['max_points'],
                'stages_entered': row['stages_entered'],
                'title': row['title'],
            }
            for row in rows
        ]})

    # ---- complaints ---------------------------------------------------------------------------
    @action(detail=True, methods=['get', 'post'])
    def complaints(self, request, pk=None):
        contest = self._contest()
        if request.method == 'GET':
            rows = contest.complaints.select_related('registration__user', 'answered_by__profile')
            if not access.is_staff(request.user, contest):
                user = request.user
                if not (user and user.is_authenticated):
                    return _refuse(rules.ANONYMOUS, status.HTTP_401_UNAUTHORIZED)
                # A participant sees their own complaints and nobody else's: a complaint is an
                # accusation about a ranking and the other people in it are not its audience.
                rows = rows.filter(registration__user=user)
            context = {'request': request, 'registration_numbers': _registration_numbers(contest)}
            return Response(ContestComplaintSerializer(rows, many=True, context=context).data)

        reason = rules.complain_block_reason(request.user, contest)
        if reason:
            code = (
                status.HTTP_409_CONFLICT
                if reason in (rules.ALREADY_OPEN, rules.WINDOW_CLOSED, rules.NOT_PUBLISHED)
                else status.HTTP_403_FORBIDDEN
            )
            return _refuse(reason, code)
        payload = ContestComplaintSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        registration = contest.registrations.get(user=request.user)
        row = ContestComplaint.objects.create(
            contest=contest, registration=registration, text=payload.validated_data['text']
        )
        context = {'request': request, 'registration_numbers': _registration_numbers(contest)}
        return Response(
            ContestComplaintSerializer(row, context=context).data, status=status.HTTP_201_CREATED
        )

    # ---- the regulamin ------------------------------------------------------------------------
    @action(detail=True, methods=['get', 'put'])
    def rules(self, request, pk=None):
        """`GET` the sections; `PUT` the whole set at once.

        The whole set, because a regulamin is one document: saving §3 and failing on §7 leaves a
        reader half a set of rules, which is worse than failing both.
        """
        contest = self._contest()
        if request.method == 'GET':
            rows = contest.rules_sections.all()
            return Response({
                'version': contest.rules_version,
                'sections': ContestRulesSectionSerializer(rows, many=True).data,
            })
        if not access.can_manage(request.user, contest):
            return _refuse(rules.NOT_MANAGER)
        incoming = request.data.get('sections')
        if not isinstance(incoming, list):
            return _refuse('sections_required', status.HTTP_400_BAD_REQUEST)
        known = set(presets.RULES_SECTIONS)
        for order, section in enumerate(incoming):
            key = section.get('key')
            if key not in known:
                return _refuse('unknown_section', status.HTTP_400_BAD_REQUEST)
            ContestRulesSection.objects.update_or_create(
                contest=contest, key=key,
                defaults={'order': section.get('order', order), 'body': section.get('body', '')},
            )
        rows = contest.rules_sections.all()
        return Response({
            'version': contest.rules_version,
            'sections': ContestRulesSectionSerializer(rows, many=True).data,
        })

    @action(detail=True, methods=['post'], url_path='rules/publish')
    def publish_rules(self, request, pk=None):
        contest, refusal = self._manageable()
        if refusal:
            return refusal
        version = rules.publish_rules(contest, actor=request.user)
        return Response(ContestRulesVersionSerializer(version).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='rules/versions')
    def rules_versions(self, request, pk=None):
        contest = self._contest()
        rows = contest.rules_versions.select_related('published_by__profile')
        return Response(ContestRulesVersionSerializer(rows, many=True).data)

    @action(
        detail=True, methods=['get'],
        url_path=f'rules/versions/(?P<number>{NUMERIC_PK_REGEX})',
    )
    def rules_version(self, request, pk=None, number=None):
        contest = self._contest()
        row = get_object_or_404(contest.rules_versions, number=int(number))
        return Response(ContestRulesVersionSerializer(row).data)

    # ---- the compliance panel -----------------------------------------------------------------
    @action(detail=True, methods=['get'])
    def compliance(self, request, pk=None):
        """Staff only — it is a list of the organiser's own obligations, several of them not yet
        met, and publishing that beside a contest people are entering would be reporting the
        organiser to their own participants."""
        contest = self._contest()
        if not access.is_staff(request.user, contest):
            return _refuse(rules.NOT_STAFF)
        return Response(compliance.report(contest))

    # ---- the certificate ----------------------------------------------------------------------
    @action(
        detail=True, methods=['get'],
        url_path=f'certificate/(?P<result_id>{NUMERIC_PK_REGEX})',
    )
    def certificate(self, request, pk=None, result_id=None):
        """What the printed sheet needs, and nothing else.

        Readable by the person it names and by the contest's staff. Not public: a certificate is a
        document about one person, and a URL that enumerates them is a list of who placed where,
        under a name their `publish_name` consent may well have said not to publish.
        """
        contest = self._contest()
        row = get_object_or_404(contest.results.select_related('registration__user__profile'), pk=result_id)
        user = request.user
        is_mine = bool(user and user.is_authenticated and row.registration.user_id == user.pk)
        if not (is_mine or access.is_staff(user, contest)):
            raise Http404
        if row.title not in CERTIFIABLE_TITLES:
            # A participant's taking part is in their learning record; a *zaświadczenie* is for the
            # titles the regulamin actually awards.
            raise Http404
        max_points = float(
            sum(stage.max_points for stage in contest.stages.prefetch_related('problems'))
        )
        return Response({
            'contest': {
                'id': contest.pk,
                'title': contest.title,
                'starts_at': contest.starts_at,
                'ends_at': contest.ends_at,
                'preset_key': contest.preset_key,
                'external_reference_url': contest.external_reference_url,
            },
            'organiser': {
                'display_name': (
                    contest.data_controller_name
                    or (contest.organization.name if contest.organization_id else '')
                    or (contest.organiser.profile.display_name
                        if getattr(contest.organiser, 'profile', None)
                        and contest.organiser.profile.display_name
                        else contest.organiser.username)
                ),
                'kind': presets.get(contest.preset_key).organiser_kind if presets.get(contest.preset_key) else 'person',
            },
            'participant': {
                'display_name': (
                    row.registration.user.profile.display_name
                    if getattr(row.registration.user, 'profile', None)
                    and row.registration.user.profile.display_name
                    else row.registration.user.username
                ),
                'affiliation': row.registration.affiliation,
            },
            'result': {
                'id': row.pk,
                'rank': row.rank,
                'title': row.title,
                'total_points': row.total_points,
                'max_points': round(max_points, 3),
                'published_at': row.published_at,
            },
        })


class ContestStaffViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """`DELETE /api/contest-staff/{id}/` — take somebody off the roster.

    `409 last_organiser` keeps the one invariant: a contest whose only organiser could be removed
    is a contest that can be taken hostage, which is the same reasoning `EventStaff` gives for its
    host and `OrganizationMember` for its last owner. The founder (`Contest.organiser`) is an
    organiser whether or not a row says so, so removing their row is harmless and allowed.
    """

    permission_classes = [permissions.IsAuthenticated, _Gate]
    serializer_class = ContestStaffSerializer

    def get_queryset(self):
        return ContestStaff.objects.select_related('contest', 'user')

    def destroy(self, request, *args, **kwargs):
        row = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        contest = row.contest
        if not access.can_view(request.user, contest):
            raise Http404
        if not access.can_manage(request.user, contest):
            return _refuse(rules.NOT_MANAGER)
        if row.role == 'organiser' and row.user_id != contest.organiser_id:
            others = contest.staff.filter(role='organiser').exclude(pk=row.pk).count()
            if others == 0 and contest.organiser_id is None:
                return _refuse(rules.LAST_ORGANISER, status.HTTP_409_CONFLICT)
        if row.user_id == contest.organiser_id and row.role == 'organiser':
            # The founder's own row. Removing it changes nothing (they are an organiser by the
            # `organiser` FK) — but saying so is better than silently doing nothing.
            return _refuse(rules.LAST_ORGANISER, status.HTTP_409_CONFLICT)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContestStageViewSet(
    mixins.RetrieveModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """One stage: its problems, its open/close/advance controls, and the one submission that
    belongs to the caller."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _Gate]
    serializer_class = ContestStageSerializer

    def get_queryset(self):
        return ContestStage.objects.select_related('contest__organiser', 'event').prefetch_related(
            'problems__exercise__translations', 'contest__staff'
        )

    def get_object(self) -> ContestStage:
        stage = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        if not access.can_view(self.request.user, stage.contest):
            raise Http404
        return stage

    def _manageable(self):
        stage = self.get_object()
        if not access.can_manage(self.request.user, stage.contest):
            return None, _refuse(rules.NOT_MANAGER)
        return stage, None

    def update(self, request, *args, **kwargs):
        stage, refusal = self._manageable()
        if refusal:
            return refusal
        preset = presets.get(stage.contest.preset_key)
        if preset is not None and preset.stages_locked:
            return _refuse('stages_locked', status.HTTP_409_CONFLICT)
        serializer = self.get_serializer(stage, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        stage, refusal = self._manageable()
        if refusal:
            return refusal
        preset = presets.get(stage.contest.preset_key)
        if preset is not None and preset.stages_locked:
            return _refuse('stages_locked', status.HTTP_409_CONFLICT)
        if stage.submissions.exclude(status='draft').exists():
            # Somebody has handed work in. House rule 12: the record of what they did stays.
            return _refuse('has_submissions', status.HTTP_409_CONFLICT)
        stage.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def open(self, request, pk=None):
        stage, refusal = self._manageable()
        if refusal:
            return refusal
        if stage.status != 'scheduled':
            return _refuse(rules.ILLEGAL_TRANSITION, status.HTTP_409_CONFLICT)
        if not stage.problems.exists() and stage.mode == 'online':
            return _refuse('no_problems', status.HTTP_409_CONFLICT)
        stage.status = 'open'
        stage.save(update_fields=['status'])
        if stage.contest.status in ('announced', 'registration_open'):
            # Opening a stage is what "running" means. Done here so an organiser does not have to
            # move the contest by hand as well, and skipped when the contest is already running.
            rules.transition(stage.contest, 'running', actor=request.user)
        return Response(ContestStageSerializer(stage, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        stage, refusal = self._manageable()
        if refusal:
            return refusal
        if stage.status != 'open':
            return _refuse(rules.ILLEGAL_TRANSITION, status.HTTP_409_CONFLICT)
        stage.status = 'closed'
        stage.save(update_fields=['status'])
        # Every draft left behind at the bell stays a draft: it was never handed in, and marking it
        # as submitted on the organiser's behalf would be the module answering for a participant.
        return Response(ContestStageSerializer(stage, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def advance(self, request, pk=None):
        stage, refusal = self._manageable()
        if refusal:
            return refusal
        reason = rules.advance_block_reason(stage)
        if reason:
            return _refuse(reason, status.HTTP_409_CONFLICT)
        chosen = rules.advance(stage)
        if not stage.contest.stages.filter(status__in=('scheduled', 'open')).exists():
            if stage.contest.status == 'running':
                rules.transition(stage.contest, 'judging', actor=request.user)
        return Response({
            'advanced': len(chosen),
            'stage': ContestStageSerializer(stage, context={'request': request}).data,
        })

    @action(detail=True, methods=['get', 'post'])
    def problems(self, request, pk=None):
        """**404 before the stage opens, for anybody who is not staff.**

        An exercise's statement is public content already — that is what the corpus is — but WHICH
        exercises a stage uses is the contest itself, and handing it out early hands out the paper.
        404 rather than 403, because for a participant the stage's problems genuinely do not exist
        yet (house rule 4).
        """
        stage = self.get_object()
        is_staff = access.is_staff(request.user, stage.contest)
        if request.method == 'GET':
            if not (is_staff or stage.problems_visible):
                raise Http404
            rows = stage.problems.select_related('exercise__branch').prefetch_related(
                'exercise__translations'
            )
            return Response(
                ContestProblemSerializer(rows, many=True, context={'request': request}).data
            )
        if not access.can_manage(request.user, stage.contest):
            return _refuse(rules.NOT_MANAGER)
        if stage.status != 'scheduled':
            return _refuse('stage_not_open', status.HTTP_409_CONFLICT)
        payload = ContestProblemSerializer(data=request.data, context={'request': request})
        payload.is_valid(raise_exception=True)
        order = payload.validated_data.get('order')
        if order is None:
            order = stage.problems.count()
        try:
            with transaction.atomic():  # its own savepoint, for the reason `staff` above records
                problem = payload.save(stage=stage, order=order)
        except IntegrityError:
            return _refuse('already_added', status.HTTP_409_CONFLICT)
        return Response(
            ContestProblemSerializer(problem, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    # ---- one participant's own submission -----------------------------------------------------
    @action(detail=True, methods=['get', 'put'])
    def submission(self, request, pk=None):
        stage = self.get_object()
        if not request.user.is_authenticated:
            return _refuse(rules.ANONYMOUS, status.HTTP_401_UNAUTHORIZED)
        registration = stage.contest.registrations.filter(user=request.user).first()
        if registration is None or not registration.is_competing:
            return _refuse(rules.NOT_ACCEPTED)
        row = ContestSubmission.objects.filter(stage=stage, registration=registration).first()
        if request.method == 'GET':
            if row is None:
                return Response({'id': None, 'status': 'draft', 'answers': []})
            return Response(
                ContestSubmissionSerializer(row, context={'request': request}).data
            )
        reason = rules.submit_block_reason(request.user, stage)
        if reason:
            code = (
                status.HTTP_409_CONFLICT
                if reason in (rules.ALREADY_SUBMITTED, rules.STAGE_NOT_OPEN)
                else status.HTTP_403_FORBIDDEN
            )
            return _refuse(reason, code)
        payload = SubmissionWriteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        if row is None:
            row = ContestSubmission.objects.create(stage=stage, registration=registration)
        problems = {p.pk: p for p in stage.problems.all()}
        from .models import ContestAnswer

        for answer in payload.validated_data['answers']:
            problem = problems.get(answer['problem_id'])
            if problem is None:
                continue
            ContestAnswer.objects.update_or_create(
                submission=row, problem=problem,
                defaults={
                    'text': answer.get('text', ''),
                    'attachment_id': answer.get('attachment_id'),
                },
            )
        return Response(ContestSubmissionSerializer(row, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        stage = self.get_object()
        reason = rules.submit_block_reason(request.user, stage)
        if reason:
            code = (
                status.HTTP_409_CONFLICT
                if reason in (rules.ALREADY_SUBMITTED, rules.STAGE_NOT_OPEN)
                else status.HTTP_403_FORBIDDEN
            )
            return _refuse(reason, code)
        registration = stage.contest.registrations.get(user=request.user)
        row, _created = ContestSubmission.objects.get_or_create(
            stage=stage, registration=registration
        )
        # ONE where-anchored update, not `select_for_update` (`backend/CLAUDE.md` rule 1): the
        # loser of a double-click sees 0 rows and is told the world moved.
        claimed = ContestSubmission.objects.filter(pk=row.pk, status='draft').update(
            status='submitted', submitted_at=timezone.now()
        )
        if not claimed:
            return _refuse(rules.ALREADY_SUBMITTED, status.HTTP_409_CONFLICT)
        row.refresh_from_db()
        return Response(ContestSubmissionSerializer(row, context={'request': request}).data)

    @action(detail=True, methods=['get'])
    def submissions(self, request, pk=None):
        """The jury's view of a closed stage: every handed-in submission, anonymised."""
        stage = self.get_object()
        if not access.can_score(request.user, stage.contest):
            return _refuse(rules.NOT_JUROR)
        if stage.status in ('scheduled', 'open'):
            return _refuse(rules.STAGE_OPEN, status.HTTP_409_CONFLICT)
        rows = (
            stage.submissions.exclude(status='draft')
            .select_related('registration__user__profile')
            .prefetch_related('answers', 'scores__juror__profile')
        )
        context = {
            'request': request,
            'registration_numbers': _registration_numbers(stage.contest),
        }
        return Response({
            'stage': ContestStageSerializer(stage, context=context).data,
            'problems': ContestProblemSerializer(
                stage.problems.select_related('exercise__branch'), many=True, context=context
            ).data,
            'submissions': [
                {
                    **ContestSubmissionSerializer(row, context=context).data,
                    'scores': ContestScoreSerializer(row.scores.all(), many=True).data,
                }
                for row in rows
            ],
        })

    @action(detail=True, methods=['get'])
    def ranking(self, request, pk=None):
        """This stage's own order, for the organiser's advance preview."""
        stage = self.get_object()
        if not access.is_staff(request.user, stage.contest):
            return _refuse(rules.NOT_STAFF)
        rows = sorted(
            (
                (row, rules.submission_points(row))
                for row in stage.submissions.exclude(status='draft').prefetch_related('scores')
            ),
            key=lambda pair: -pair[1],
        )
        numbers = _registration_numbers(stage.contest)
        return Response({'rows': [
            {
                'submission': row.pk,
                'number': numbers.get(row.registration_id, 0),
                'points': round(points, 3),
                'max_points': stage.max_points,
                'advanced': row.advanced,
            }
            for row, points in rows
        ]})


class ContestProblemViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated, _Gate]
    serializer_class = ContestProblemSerializer

    def get_queryset(self):
        return ContestProblem.objects.select_related('stage__contest')

    def destroy(self, request, *args, **kwargs):
        row = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        contest = row.stage.contest
        if not access.can_view(request.user, contest):
            raise Http404
        if not access.can_manage(request.user, contest):
            return _refuse(rules.NOT_MANAGER)
        if row.stage.status != 'scheduled':
            return _refuse('stage_not_open', status.HTTP_409_CONFLICT)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContestRegistrationViewSet(viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated, _Gate]
    serializer_class = ContestRegistrationSerializer

    def get_queryset(self):
        return ContestRegistration.objects.select_related('contest__organiser', 'user__profile')

    def _row(self) -> ContestRegistration:
        row = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        if not access.can_view(self.request.user, row.contest):
            raise Http404
        return row

    def _read(self, row):
        context = {
            'request': self.request,
            'registration_numbers': _registration_numbers(row.contest),
        }
        return Response(ContestRegistrationSerializer(row, context=context).data)

    @action(detail=True, methods=['post'])
    def decide(self, request, pk=None):
        row = self._row()
        if not access.can_manage(request.user, row.contest):
            return _refuse(rules.NOT_MANAGER)
        payload = DecideSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        decision = payload.validated_data['decision']
        # The world-moved check as one WHERE-anchored update (`backend/CLAUDE.md` rule 1).
        claimed = ContestRegistration.objects.filter(pk=row.pk, status='requested').update(
            status=decision, decided_by=request.user, decided_at=timezone.now()
        )
        if not claimed:
            return _refuse(rules.ALREADY_REGISTERED, status.HTTP_409_CONFLICT)
        row.refresh_from_db()
        return self._read(row)

    @action(detail=True, methods=['post'])
    def withdraw(self, request, pk=None):
        row = self._row()
        if row.user_id != request.user.pk:
            return _refuse(rules.NOT_PARTICIPANT)
        if row.status in ('withdrawn', 'disqualified', 'declined'):
            return _refuse(rules.ALREADY_REGISTERED, status.HTTP_409_CONFLICT)
        row.status = 'withdrawn'
        row.decided_at = timezone.now()
        row.save(update_fields=['status', 'decided_at'])
        return self._read(row)

    @action(detail=True, methods=['post'])
    def disqualify(self, request, pk=None):
        row = self._row()
        if not access.can_manage(request.user, row.contest):
            return _refuse(rules.NOT_MANAGER)
        row.status = 'disqualified'
        row.decided_by = request.user
        row.decided_at = timezone.now()
        row.save(update_fields=['status', 'decided_by', 'decided_at'])
        return self._read(row)

    @action(detail=True, methods=['patch'], url_path='publish-name')
    def publish_name(self, request, pk=None):
        """The separate, revocable consent (CONTESTS-LAW.md §4; UODO's own model regulamin).

        Its own endpoint on purpose: withdrawing a consent to publish your name must not be the
        same act as withdrawing from the contest, and a checkbox buried in the registration form is
        not a separate consent whatever it is labelled. Only the participant themself may change
        it — not the organiser, who is the party the consent is given TO.
        """
        row = self._row()
        if row.user_id != request.user.pk:
            return _refuse(rules.NOT_PARTICIPANT)
        payload = PublishNameSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        row.publish_name = payload.validated_data['publish_name']
        row.save(update_fields=['publish_name'])
        return self._read(row)


class ContestSubmissionViewSet(viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated, _Gate]
    serializer_class = ContestSubmissionSerializer

    def get_queryset(self):
        return ContestSubmission.objects.select_related(
            'stage__contest__organiser', 'registration__user'
        ).prefetch_related('scores', 'stage__problems')

    @action(detail=True, methods=['post'])
    def scores(self, request, pk=None):
        row = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        if not access.can_view(request.user, row.stage.contest):
            raise Http404
        reason = rules.score_block_reason(request.user, row)
        if reason:
            code = (
                status.HTTP_409_CONFLICT if reason == rules.STAGE_OPEN
                else status.HTTP_403_FORBIDDEN
            )
            return _refuse(reason, code)
        payload = ScoresWriteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        rules.set_scores(request.user, row, payload.validated_data['scores'])
        row.refresh_from_db()
        context = {
            'request': request,
            'registration_numbers': _registration_numbers(row.stage.contest),
        }
        return Response({
            **ContestSubmissionSerializer(row, context=context).data,
            'scores': ContestScoreSerializer(row.scores.all(), many=True).data,
        })


class ContestComplaintViewSet(viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated, _Gate]
    serializer_class = ContestComplaintSerializer

    def get_queryset(self):
        return ContestComplaint.objects.select_related('contest__organiser', 'registration__user')

    @action(detail=True, methods=['post'])
    def answer(self, request, pk=None):
        row = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        if not access.can_view(request.user, row.contest):
            raise Http404
        role = access.role_of(request.user, row.contest)
        if role not in ('organiser', 'secretary'):
            # The secretary's job, by the preset's own checklist (`complaints_answered`).
            return _refuse(rules.NOT_MANAGER)
        payload = ComplaintAnswerSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        claimed = ContestComplaint.objects.filter(pk=row.pk, status='open').update(
            status='answered', answer=payload.validated_data['answer'],
            answered_by=request.user, answered_at=timezone.now(),
        )
        if not claimed:
            return _refuse('already_answered', status.HTTP_409_CONFLICT)
        row.refresh_from_db()
        # `update()` bypasses `save()`, so the answer has not been through the sanitizer yet
        # (house rule 8) — one more save does it, and the WHERE-anchored claim above is still what
        # decided the race.
        row.save(update_fields=['answer'])
        context = {
            'request': request,
            'registration_numbers': _registration_numbers(row.contest),
        }
        return Response(ContestComplaintSerializer(row, context=context).data)

    @action(detail=True, methods=['post'])
    def withdraw(self, request, pk=None):
        row = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        if row.registration.user_id != request.user.pk:
            return _refuse(rules.NOT_PARTICIPANT)
        if row.status != 'open':
            return _refuse('already_answered', status.HTTP_409_CONFLICT)
        row.status = 'withdrawn'
        row.save(update_fields=['status'])
        context = {
            'request': request,
            'registration_numbers': _registration_numbers(row.contest),
        }
        return Response(ContestComplaintSerializer(row, context=context).data)
