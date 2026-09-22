"""`/api/material-projects/`, `/api/material-versions/`, `/api/project-invites/`,
`/api/project-join-requests/`.

Thin on purpose: resolve the object, ask `access.py`, call `services.py`, serialize. Nothing here
decides a rule and nothing here writes a side effect — those two sentences are what keep the app's
trust model readable in two files instead of ten.

**Two switches, two abilities** (COAUTHORING-BRIEF.md §0). `coauthoring` gates collaborating on a
material that exists — versions, proposals, members, invites, join requests — and is the class-level
gate on everything in this module bar three actions. `material_submissions` gates bringing a NEW
material into being, and it alone gates project creation, because that is the ability the retired
`/submit-material` form had and killing one must not kill the other. Staff bypass both, as
everywhere.

The three exceptions are **create**, **publish** and **decide**, and they are exceptions because
which switch applies is a property of the PROJECT rather than of the endpoint (`access
.governing_switch`): publishing or deciding a project's FIRST version is bringing a new material
into being, whatever the button that did it was called, and everything after that is collaboration.
With `coauthoring` off, a person must still be able to send a new material and staff or a governor
must still be able to accept it — that is the whole point of two switches, and a class-level gate
could not express it.

**404 versus 403.** A project a caller cannot see is not there (`access.visible_projects` is the
queryset half, and a draft is simply absent for a stranger). A project they CAN see but may not act
on answers 403, because pretending it does not exist would be a lie they can disprove by reloading
the page they are looking at. That split is house rule 4 and the API convention in
backend/CLAUDE.md, applied per action rather than per viewset.
"""

from __future__ import annotations

from functools import wraps

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from community.views import comment_thread_response
from moderation.permissions import feature_gate

from .access import (
    can_decide,
    can_edit,
    can_manage,
    can_view_version,
    governing_switch,
    role_of,
    switch_allows,
    visible_projects,
)
from .models import (
    MIN_JOIN_STATEMENT_LENGTH,
    MaterialVersion,
    ProjectInvite,
    ProjectJoinRequest,
)
from .serializers import (
    MaterialProjectCreateSerializer,
    MaterialProjectSerializer,
    MaterialProjectTeaserSerializer,
    MaterialProjectUpdateSerializer,
    MaterialVersionSerializer,
    MaterialVersionSummarySerializer,
    MaterialVersionWriteSerializer,
    ProjectInviteSerializer,
    ProjectInviteWriteSerializer,
    ProjectJoinRequestSerializer,
    ProjectMemberSerializer,
)
from .services import (
    Conflict,
    Refused,
    Stale,
    accept_invite,
    add_member,
    create_join_request,
    create_project,
    decide_join_request,
    decide_version,
    publish_version,
    remove_member,
    save_version,
    transfer_ownership,
    withdraw_join_request,
    withdraw_version,
)

User = get_user_model()

_CoauthGate = feature_gate('coauthoring')
#: Creating a NEW material — the ability `/submit-material` has always had, and the switch that has
#: always gated it. Deliberately not `coauthoring`: turning collaboration off must leave the submit
#: form working, and turning submissions off must leave existing teams working.
_CreateGate = feature_gate('material_submissions')


def _switch_refusal(request, project):
    """`None`, or exactly the 403 `feature_gate` would have produced for this project's own switch.

    The one helper `publish` and `decide` both ask, because they are the two actions whose switch
    depends on the version in front of them rather than on the URL (`access.governing_switch`).
    The body is read off the gate class itself rather than retyped, so a caller cannot tell whether
    a killed feature refused them from a permission class or from here — and the `is_staff` bypass
    is `access.switch_allows`, which is that gate's own rule in one place.
    """
    if switch_allows(project, request.user):
        return None
    return Response(
        {'detail': feature_gate(governing_switch(project)).message},
        status=status.HTTP_403_FORBIDDEN,
    )


#: The fields a catalogue PATCH writes onto the `Material` row once one exists. `requirements` and
#: `coverage` are absent, and that is a decision rather than an omission — on a published material
#: those are real, votable rows (`MaterialRequirement`, `MaterialCoverage`) with their own
#: endpoints, and letting a project PATCH replace them wholesale would silently discard everybody's
#: votes. While drafting they are plain JSON on the project and a PATCH does write them.
_MATERIAL_CATALOGUE_FIELDS = (
    'type',
    'audience',
    'author',
    'source_url',
    'price_amount',
    'price_currency',
    'estimated_minutes',
)


def _translates_service_errors(handler):
    """Turn this module's three service exceptions into the three responses the frontend expects.

    One place, because the split is the part that matters and it must not be re-decided per
    endpoint: **409 means the world moved** (already decided, no longer a draft, the head changed)
    and **400 means the request was refused** by a rule. Root CLAUDE.md is explicit that conflating
    them is a bug; `services/materialProjects.ts` turns them into two different error classes and a
    component picks a different sentence for each.

    A `Stale` carries the head, so the editor can show what landed underneath rather than the word
    "conflict".
    """

    @wraps(handler)
    def wrapper(self, request, *args, **kwargs):
        try:
            return handler(self, request, *args, **kwargs)
        except Stale as exc:
            body = {'detail': 'stale'}
            if exc.head is not None:
                body['head'] = MaterialVersionSummarySerializer(
                    exc.head, context={'request': request}
                ).data
            return Response(body, status=status.HTTP_409_CONFLICT)
        except Conflict as exc:
            return Response({'detail': exc.reason}, status=status.HTTP_409_CONFLICT)
        except Refused as exc:
            return Response({'detail': exc.reason}, status=status.HTTP_400_BAD_REQUEST)

    return wrapper


def _project_queryset(user):
    """Every project this caller may reach, with everything the serializer walks already loaded.

    The prefetches are not incidental: `MaterialProjectSerializer` reads `members.all()` and
    `versions.all()` for the role, the head, the published row and the pending count, and without
    these a listing of twenty projects would pay four queries each — the N+1 shape the moderation
    queue was once measured making.
    """
    return (
        visible_projects(user)
        .select_related('branch', 'material', 'created_by__profile')
        .prefetch_related(
            'branch__translations',
            'members__user__profile',
            'versions__created_by__profile',
            'material__requirements',
            'material__coverage',
        )
    )


class MaterialProjectViewSet(viewsets.GenericViewSet):
    """The project itself, its versions, its team, its links and its applicants."""

    permission_classes = [_CoauthGate]
    serializer_class = MaterialProjectSerializer
    # A version may carry a file, so the two write actions that accept one have to speak multipart —
    # and JSON, because a link or a written body has nothing to upload and the frontend sends the
    # cheaper shape when there is no file.
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_classes = [ScopedRateThrottle]

    def get_queryset(self):
        return _project_queryset(self.request.user)

    def get_permissions(self):
        if self.action == 'create':
            # `material_submissions` ONLY — deliberately without `_CoauthGate`. Bringing a new
            # material into being is the ability this endpoint inherited from `/submit-material`,
            # and it has to keep working with collaboration switched off, or killing one switch
            # would take away the only way anybody can contribute a material at all.
            return [_CreateGate(), permissions.IsAuthenticated()]
        perms = [_CoauthGate()]
        if self.request.method not in permissions.SAFE_METHODS:
            perms.append(permissions.IsAuthenticated())
        elif self.action in ('join_requests',):
            # Even the GET half is private: a list of who has asked to join is not public, and the
            # requester's own row is only theirs because they are signed in.
            perms.append(permissions.IsAuthenticated())
        return perms

    def get_throttles(self):
        """Scope the tight budgets to the WRITE half of each action and nothing else.

        Set here rather than as a class attribute, the shape the retired `MaterialSubmissionViewSet`
        recorded: a ViewSet's actions are not all the same request, and reading a project's invite
        list is an ordinary cheap GET that should keep the loose global `user` budget while minting
        one is a thing worth bounding. `ScopedRateThrottle` treats a falsy `throttle_scope` as
        "not scoped".

        **Creating a project spends the `material_submission` budget** (20/hour), which is the one
        the submit form has always had: this endpoint is that form now, the request is the same size
        (up to 25MB, a re-encode and a malware scan), and moving it onto the version budget would
        have quietly given a would-be flooder a second allowance beside the first. Saving a further
        version keeps its own, looser `material_version` scope — editing what you already sent is a
        different act from sending another one.
        """
        writing = self.request.method not in permissions.SAFE_METHODS
        scope = None
        if writing:
            if self.action == 'create':
                scope = 'material_submission'
            elif self.action == 'versions':
                scope = 'material_version'
            elif self.action in ('invites', 'invite_detail'):
                scope = 'project_invite'
            elif self.action == 'join_requests':
                scope = 'project_join'
        self.throttle_scope = scope
        return super().get_throttles()

    # --- resolving ------------------------------------------------------------------------------

    def _project(self, pk):
        """The project, or None — the caller turns None into a 404.

        Scoped through `visible_projects`, so a stranger poking at a draft's id gets "there is no
        such thing", which is the honest answer as well as the safe one.
        """
        return self.get_queryset().filter(pk=pk).first()

    def _serializer_class_for(self, project):
        """A teaser for a draft the caller cannot edit; the full shape otherwise.

        One condition, in one place. A project with a material is as public as the material, so the
        teaser is only ever the answer for a `seeking_coauthors` draft somebody is browsing.
        """
        if project.material_id is None and not can_edit(project, self.request.user):
            return MaterialProjectTeaserSerializer
        return MaterialProjectSerializer

    def _project_data(self, project):
        serializer_class = self._serializer_class_for(project)
        return serializer_class(project, context={'request': self.request}).data

    # --- list / retrieve / create / patch --------------------------------------------------------

    def list(self, request):
        """`?mine=1`, `?seeking=1[&branch=<slug>]`, or `?material=<id>`.

        With no selector this answers the `seeking` list, because that is the one listing that means
        anything without a caller — "projects looking for people" is a public page, "mine" is not.
        """
        queryset = self.get_queryset()
        material_id = request.query_params.get('material')
        if material_id:
            # The project behind one material. A bare array of 0 or 1 rather than a detail route,
            # so the caller never has to turn a 404 into "no project" itself. A non-numeric id
            # answers with an empty list rather than a 500 — a client sending junk should not be
            # able to produce one.
            if not str(material_id).isdigit():
                return Response([])
            queryset = queryset.filter(material_id=int(material_id))
        elif request.query_params.get('mine') in ('1', 'true'):
            if not request.user.is_authenticated:
                return Response(status=status.HTTP_401_UNAUTHORIZED)
            queryset = queryset.filter(members__user=request.user).distinct()
        else:
            queryset = queryset.filter(material__isnull=True, seeking_coauthors=True)
            branch = request.query_params.get('branch')
            if branch:
                queryset = queryset.filter(branch__slug=branch)
        return Response([self._project_data(project) for project in queryset])

    def retrieve(self, request, pk=None):
        project = self._project(pk)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(self._project_data(project))

    @_translates_service_errors
    def create(self, request):
        """Start a project: the row, its owner, and version 1 — as a draft, or published outright.

        **This is the submit form.** Since the single-shot upload was folded in
        (`coauthoring/0003_fold_material_submissions`), there is exactly one way a material comes
        into being, and "somebody with a team of one sends a finished thing" is the ordinary case
        rather than a special one. `publish: true` says so, and this action then calls
        `publish_version` itself: one request, because a client that crashed between two would have
        left a draft nobody meant to keep, and because the person filling in that form pressed one
        button.

        The answer is the project either way, re-read through `_project_queryset` so its
        `material_id` and `head_version` are the real ones rather than the pre-publication values —
        and those two are how the caller tells which of the three outcomes it got: published
        (`material_id` set, head `published`), queued for a moderator (head `proposed`), or still a
        draft because nobody asked for it to go anywhere.

        Behind `material_submissions` rather than `coauthoring` — see the module docstring. Minors
        are refused with `minor`, which is a rule about publishing without a person in between and
        not a judgement about the work (they may still propose).
        """
        catalogue = MaterialProjectCreateSerializer(data=request.data)
        catalogue.is_valid(raise_exception=True)
        payload = MaterialVersionWriteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        version_payload = dict(payload.validated_data)
        # A brand-new project has nothing to have been written against, whatever the client sent.
        version_payload.pop('based_on', None)

        project = create_project(
            request.user,
            branch=catalogue.validated_data['branch'],
            locale=catalogue.validated_data.get('locale') or 'pl',
            catalogue=catalogue.catalogue(),
            version_payload=version_payload,
        )
        if catalogue.validated_data.get('publish'):
            # `publish_version` decides which outcome this person gets (published outright for
            # staff, a verified contributor or the branch's governor; the moderation queue for
            # everybody else) — the same function the Publish button calls, so the two paths cannot
            # drift about who skips review. A failure here leaves the draft: it is saved, it is
            # theirs, and the project page's own Publish button is what they try next.
            publish_version(
                project.versions.order_by('number').first(), request.user, request=request
            )
        project = self._project(project.pk) or project
        return Response(self._project_data(project), status=status.HTTP_201_CREATED)

    @_translates_service_errors
    def partial_update(self, request, pk=None):
        """The catalogue, the seeking flag, and (while drafting) the locale.

        **After the first publication a catalogue edit is written to the `Material`**, not to this
        row: the project's copies are frozen from that moment, and a browse filter must have exactly
        one place to read `type`/`audience`/`price` from. One endpoint rather than two because the
        person editing does not care which side of that line the project is on.
        """
        project = self._project(pk)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_edit(project, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)

        serializer = MaterialProjectUpdateSerializer(
            data=request.data, context={'request': request, 'project': project}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        project_fields = []
        for field in ('seeking_coauthors', 'seeking_note'):
            if field in data:
                setattr(project, field, data[field])
                project_fields.append(field)
        if 'locale' in data and project.material_id is None:
            # Frozen after publication: the published translation row is keyed by this, and moving
            # it would orphan the text somebody already published.
            project.locale = data['locale']
            project_fields.append('locale')

        material = project.material
        for field in _MATERIAL_CATALOGUE_FIELDS:
            if field not in data:
                continue
            if material is not None:
                setattr(material, field, data[field])
            else:
                setattr(project, field, data[field])
                project_fields.append(field)
        if material is None:
            for field in ('requirements', 'coverage'):
                if field in data:
                    setattr(project, field, data[field])
                    project_fields.append(field)

        if project_fields:
            # `seeking_note` is sanitized by `MaterialProject.save()`, so it has to be in the list.
            project.save(update_fields=sorted(set(project_fields)))
        if material is not None and any(f in data for f in _MATERIAL_CATALOGUE_FIELDS):
            material.save(update_fields=[f for f in _MATERIAL_CATALOGUE_FIELDS if f in data])

        _audit_project(
            request,
            project,
            action='content_edit',
            summary=f'Edited the catalogue of project {project.pk}',
            detail={'fields': sorted(data.keys()), 'on_material': material is not None},
        )
        project = self._project(project.pk) or project
        return Response(self._project_data(project))

    # --- versions --------------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'])
    @_translates_service_errors
    def versions(self, request, pk=None):
        """GET the history this caller may see; POST a new version.

        The GET answers with whatever `can_view_version` allows per row rather than a single
        blanket rule, because the four private statuses have different audiences: a draft is the
        team's, a proposal is its author's and its deciders'.
        """
        project = self._project(pk)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == 'GET':
            rows = [v for v in project.versions.all() if can_view_version(v, request.user)]
            rows.sort(key=lambda v: v.number)
            return Response(
                MaterialVersionSerializer(rows, many=True, context={'request': request}).data
            )

        payload = MaterialVersionWriteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = dict(payload.validated_data)
        based_on = data.pop('based_on', None)
        version = save_version(project, request.user, data, based_on=based_on)
        return Response(
            MaterialVersionSerializer(version, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    # --- the team --------------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'])
    @_translates_service_errors
    def members(self, request, pk=None):
        """The roster, and adding to it by account id.

        By id because this app has no people search (COAUTHORING-BRIEF.md §9) — the invite link is
        the ergonomic path and this is the deliberate manual one.
        """
        project = self._project(pk)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == 'GET':
            rows = sorted(
                project.members.all(),
                key=lambda row: (row.role != 'owner', row.added_at, row.pk),
            )
            return Response(
                ProjectMemberSerializer(rows, many=True, context={'request': request}).data
            )

        if not can_manage(project, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        user = _user_from(request.data.get('user_id'))
        if user is None:
            return Response(
                {'user_id': ['No account with that id.']}, status=status.HTTP_400_BAD_REQUEST
            )
        member = add_member(project, user, added_by=request.user, request=request)
        return Response(
            ProjectMemberSerializer(member, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['delete'], url_path='members/(?P<user_id>[^/.]+)')
    @_translates_service_errors
    def member_detail(self, request, pk=None, user_id=None):
        """Remove somebody, or leave yourself — the same row, so the same endpoint."""
        project = self._project(pk)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        user = _user_from(user_id)
        if user is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        leaving = user.pk == request.user.pk
        if not leaving and not can_manage(project, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        remove_member(project, user, by=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    @_translates_service_errors
    def transfer(self, request, pk=None):
        """Hand the project over. The owner (or staff) only — a co-author cannot give away what is
        not theirs, and a governor deliberately cannot either: governance is oversight of content,
        not ownership of somebody's project."""
        project = self._project(pk)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not (request.user.is_staff or role_of(project, request.user) == 'owner'):
            return Response(status=status.HTTP_403_FORBIDDEN)
        user = _user_from(request.data.get('user_id'))
        if user is None:
            return Response(
                {'user_id': ['No account with that id.']}, status=status.HTTP_400_BAD_REQUEST
            )
        transfer_ownership(project, request.user, user, request=request)
        project = self._project(project.pk) or project
        return Response(self._project_data(project))

    # --- invites ---------------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'])
    @_translates_service_errors
    def invites(self, request, pk=None):
        project = self._project(pk)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_manage(project, request.user):
            # A link IS the authorisation, so the list of live links is as sensitive as the links.
            return Response(status=status.HTTP_403_FORBIDDEN)
        if request.method == 'GET':
            return Response(
                ProjectInviteSerializer(
                    project.invites.all(), many=True, context={'request': request}
                ).data
            )
        write = ProjectInviteWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        invite = write.save(
            project=project, created_by=request.user, token=ProjectInvite.new_token()
        )
        _audit_project(
            request,
            project,
            action='permission_change',
            summary=f'Created an invite link for project {project.pk}',
            detail={'invite_id': invite.pk, 'max_uses': invite.max_uses},
        )
        return Response(
            ProjectInviteSerializer(invite, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['delete'], url_path='invites/(?P<invite_id>[^/.]+)')
    @_translates_service_errors
    def invite_detail(self, request, pk=None, invite_id=None):
        """Revoking a link: a timestamp, never a delete, so the row keeps its use count and the
        record of who killed it (house rule 12)."""
        project = self._project(pk)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_manage(project, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        invite = project.invites.filter(pk=invite_id).first()
        if invite is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not invite.revoked_at:
            invite.revoked_at = timezone.now()
            invite.save(update_fields=['revoked_at'])
        _audit_project(
            request,
            project,
            action='permission_change',
            summary=f'Revoked an invite link for project {project.pk}',
            detail={'invite_id': invite.pk},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    # --- join requests -----------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'], url_path='join-requests')
    @_translates_service_errors
    def join_requests(self, request, pk=None):
        """GET what is waiting; POST an application.

        **A signed-in caller always sees their OWN rows**, even a pending one on a project they are
        not on. That is not a leak, it is the only way somebody can withdraw an application they
        filed — and a list they cannot read is a request they cannot take back. Managers see every
        pending row; a non-manager sees nothing but their own.
        """
        project = self._project(pk)
        if project is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == 'GET':
            rows = project.join_requests.select_related('user__profile', 'decided_by')
            if can_manage(project, request.user):
                rows = rows.filter(status='pending')
            else:
                rows = rows.filter(user=request.user)
            return Response(
                ProjectJoinRequestSerializer(rows, many=True, context={'request': request}).data
            )

        statement = (request.data.get('statement') or '').strip()
        if len(statement) < MIN_JOIN_STATEMENT_LENGTH:
            return Response(
                {
                    'statement': [
                        f'Say a little more — at least {MIN_JOIN_STATEMENT_LENGTH} characters. '
                        f'A co-author reads this.'
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        row = create_join_request(project, request.user, statement)
        return Response(
            ProjectJoinRequestSerializer(row, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class MaterialVersionViewSet(viewsets.GenericViewSet):
    """One version: reading it, publishing it, deciding it, taking it back, talking about it."""

    permission_classes = [_CoauthGate]
    serializer_class = MaterialVersionSerializer

    #: The two actions whose kill switch depends on the version rather than on the endpoint, and so
    #: cannot be a class-level gate: they answer `_switch_refusal` once the project is in hand.
    _PER_PROJECT_SWITCH_ACTIONS = ('publish', 'decide')

    def get_permissions(self):
        perms = []
        if self.action not in self._PER_PROJECT_SWITCH_ACTIONS:
            perms.append(_CoauthGate())
        if self.request.method not in permissions.SAFE_METHODS:
            perms.append(permissions.IsAuthenticated())
        return perms

    def get_queryset(self):
        return MaterialVersion.objects.select_related(
            'project__branch',
            'project__material',
            'created_by__profile',
            'decided_by__profile',
        ).prefetch_related('project__members__user__profile', 'project__versions')

    def _version(self, pk):
        version = self.get_queryset().filter(pk=pk).first()
        if version is None:
            return None
        if not can_view_version(version, self.request.user):
            # Not 403: a draft or somebody else's proposal is not a thing this caller can know
            # exists, and saying "forbidden" would confirm that it does.
            return None
        return version

    def _data(self, version, request):
        return MaterialVersionSerializer(version, context={'request': request}).data

    def retrieve(self, request, pk=None):
        version = self._version(pk)
        if version is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(self._data(version, request))

    @action(detail=True, methods=['post'])
    @_translates_service_errors
    def publish(self, request, pk=None):
        """Publish a draft — or queue it, when it is a first publication nobody has vouched for.

        Answers 200 with the version either way and the caller reads its `status`: `published`
        normally, `proposed` when it went to the moderation queue instead. Two outcomes of one
        button, and only the server knows which one this person gets.

        The switch is asked per project rather than per endpoint (`_switch_refusal`): a project's
        first publication answers to `material_submissions`, everything after it to `coauthoring`.
        Order is 404 (you cannot see this version), then 403 for the switch, then 403 for authority
        — a killed feature must not become a way to find out which ids exist.
        """
        version = self._version(pk)
        if version is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        refused = _switch_refusal(request, version.project)
        if refused is not None:
            return refused
        if not can_edit(version.project, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        version = publish_version(version, request.user, request=request)
        return Response(self._data(version, request))

    @action(detail=True, methods=['post'])
    @_translates_service_errors
    def decide(self, request, pk=None):
        """Accept or reject a proposal. `{decision: 'accept'|'reject', note?}`.

        The deciding circle is `access.can_decide`, which is narrower or wider depending on whether
        the project needs staff review — the moderation queue's own Versions tab calls THIS endpoint
        rather than a new `_KIND_MODELS` kind, for the reason `moderation/CLAUDE.md` records about
        solution entries: one decision path, one claim, one notification sequence to keep correct.

        Behind the same per-project switch `publish` answers to, and for the sharper half of the
        same reason: accepting a first publication with `coauthoring` off is exactly what "submitting
        a new material still works end to end" means, and it is the step a moderator or a branch
        governor has to be able to take for somebody else.
        """
        version = self._version(pk)
        if version is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        refused = _switch_refusal(request, version.project)
        if refused is not None:
            return refused
        if not can_decide(version, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        version = decide_version(
            version,
            request.user,
            (request.data.get('decision') or '').strip(),
            request.data.get('note') or '',
            request=request,
        )
        return Response(self._data(version, request))

    @action(detail=True, methods=['post'])
    @_translates_service_errors
    def withdraw(self, request, pk=None):
        version = self._version(pk)
        if version is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        version = withdraw_version(version, request.user)
        return Response(self._data(version, request))

    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        """The review thread on one version — `community.Comment` through the shared helper, whose
        same-thread `parent` check is the load-bearing part.

        Visibility follows `can_view_version` and nothing else, which is exactly why
        `community.targets.PRIVATE_TARGET_TYPES` lists `materialVersion`: most versions are not
        public, so a per-type table cannot say otherwise and a course must not be able to link one
        of these threads in.
        """
        version = self._version(pk)
        if version is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return comment_thread_response(request, version)


class ProjectJoinRequestViewSet(viewsets.GenericViewSet):
    """Deciding and withdrawing an application, addressed by its own id."""

    permission_classes = [_CoauthGate, permissions.IsAuthenticated]
    serializer_class = ProjectJoinRequestSerializer

    def get_queryset(self):
        return ProjectJoinRequest.objects.select_related(
            'project__branch', 'project__material', 'user__profile'
        ).prefetch_related('project__members__user__profile', 'project__versions')

    def _row(self, pk):
        """The application, or None for anybody who has no business knowing it exists.

        An application is private to the person who filed it and to whoever may decide it, so for
        everybody else it is a 404 rather than a 403 — "forbidden" would confirm that somebody asked
        to join that project (house rule 4).
        """
        row = self.get_queryset().filter(pk=pk).first()
        if row is None:
            return None
        user = self.request.user
        if row.user_id == user.pk or can_manage(row.project, user):
            return row
        return None

    @action(detail=True, methods=['post'])
    @_translates_service_errors
    def decide(self, request, pk=None):
        row = self._row(pk)
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_manage(row.project, request.user):
            # The applicant themself: they can see their row, but deciding it is not theirs.
            return Response(status=status.HTTP_403_FORBIDDEN)
        row = decide_join_request(
            row,
            request.user,
            (request.data.get('decision') or '').strip(),
            request.data.get('note') or '',
            request=request,
        )
        return Response(ProjectJoinRequestSerializer(row, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    @_translates_service_errors
    def withdraw(self, request, pk=None):
        row = self._row(pk)
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if row.user_id != request.user.pk:
            return Response(status=status.HTTP_403_FORBIDDEN)
        row = withdraw_join_request(row, request.user)
        return Response(ProjectJoinRequestSerializer(row, context={'request': request}).data)


# --- following an invite link -----------------------------------------------------------------------
# Two plain function views rather than actions on the viewset, for the reason `courses`' own pair
# gives: somebody holding a link knows the token and nothing else, so there is no project id to
# route by. The token IS the authorisation.


def _invite_or_none(token: str):
    return (
        ProjectInvite.objects.select_related(
            'project__branch', 'project__material', 'created_by__profile'
        )
        .prefetch_related('project__versions', 'project__members__user__profile')
        .filter(token=token)
        .first()
    )


@api_view(['GET'])
@permission_classes([permissions.AllowAny, _CoauthGate])
def invite_preview(request, token=None):
    """What the link says before you act on it — readable while logged out, deliberately.

    Somebody sent this to a person who may not have an account, and telling them to sign up without
    saying what for is how an invite gets ignored. Thin, because a token travels through group
    chats: the material's name, the subject, who invited them, and whether it still works.
    """
    invite = _invite_or_none(token or '')
    if invite is None:
        return Response(status=status.HTTP_404_NOT_FOUND)
    project = invite.project
    head = project.head_version
    from config.i18n_utils import request_locale, resolve_translation

    branch_translation = resolve_translation(
        project.branch.translations, request_locale({'request': request})
    )
    return Response(
        {
            'project_id': project.pk,
            'material_id': project.material_id,
            'title': head.title if head is not None else '',
            'branch_name': (
                branch_translation.name if branch_translation else project.branch.slug
            ),
            'created_by_display_name': (
                getattr(getattr(invite.created_by, 'profile', None), 'display_name', '')
                or getattr(invite.created_by, 'username', '')
            ),
            'is_usable': invite.is_usable,
            'unusable_reason': invite.unusable_reason(),
        }
    )


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated, _CoauthGate])
def invite_accept(request, token=None):
    """Following the link, for real. Five refusals, five sentences (house rule 6)."""
    invite = _invite_or_none(token or '')
    if invite is None:
        return Response(status=status.HTTP_404_NOT_FOUND)
    try:
        project = accept_invite(invite, request.user, request=request)
    except Refused as exc:
        return Response({'detail': exc.reason}, status=status.HTTP_400_BAD_REQUEST)
    project = (
        _project_queryset(request.user).filter(pk=project.pk).first() or project
    )
    return Response(MaterialProjectSerializer(project, context={'request': request}).data)


# --- small shared bits --------------------------------------------------------------------------------


def _user_from(raw):
    """An account id from the wire, or None. Never raises on nonsense — every caller turns None into
    a 400 or a 404, and a client sending junk should not be able to produce a 500."""
    try:
        return User.objects.filter(pk=int(raw)).first()
    except (TypeError, ValueError):
        return None


def _audit_project(
    request, project, *, action: str, summary: str, detail: dict | None = None
) -> None:
    """One `AuditEvent` for the three writes this module records itself.

    The version paths audit from `services.py` (they know what they published and what they
    decided); a catalogue edit, minting a link and revoking one have no service function of their
    own, so they record here. Outside any `atomic()` block, after the write, which is
    `record_audit`'s own rule.
    """
    from telemetry.audit import record_audit

    if not getattr(request.user, 'is_authenticated', False):
        return
    record_audit(
        request,
        action=action,
        target_type='material_project',
        target_id=project.pk,
        summary=summary,
        detail=detail,
    )


__all__ = [
    'MaterialProjectViewSet',
    'MaterialVersionViewSet',
    'ProjectJoinRequestViewSet',
    'invite_preview',
    'invite_accept',
]
