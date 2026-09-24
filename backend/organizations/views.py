"""`/api/organizations/`, `/api/organization-members/`, `/api/organization-links/`, and the
organisations behind one node.

The permission posture is the project's standard one (root `CLAUDE.md`, "API conventions"):

- **Public GET where the content is public.** An active organisation, its roster and what it stands
  behind are the whole point of having a page, so reads are open — and the whole surface still sits
  behind `feature_gate('organizations')`, so with the switch off a non-staff caller gets 403
  everywhere here while every other API keeps working untouched (house rule 3).
- **Visibility is a queryset filter; authority is an object-level check, and both are needed**
  (house rule 4). Every pk-addressed action below asks `access.py` explicitly before it writes,
  because the filter that scopes a list never runs for an id in a URL.
- **409 means the world moved** — the last owner, a link somebody else already made. 403 means "not
  you" for a real object you may see; 404 means "for you this does not exist".
"""

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.http import Http404
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from moderation.permissions import feature_gate

from . import services
from .access import (
    FEATURE_KEY,
    can_manage,
    found_block_reason,
    link_block_reason,
    organizations_managed_by,
    remove_block_reason,
    visible_organizations,
)
from .models import Organization, OrganizationLink, OrganizationMember
from .serializers import (
    OrganizationLinkSerializer,
    OrganizationLinkWriteSerializer,
    OrganizationMemberRoleSerializer,
    OrganizationMemberSerializer,
    OrganizationMemberWriteSerializer,
    OrganizationSerializer,
    OrganizationSummarySerializer,
    OrganizationWriteSerializer,
)

_OrganizationsGate = feature_gate(FEATURE_KEY)

User = get_user_model()


def _forbidden(reason):
    return Response({'detail': reason}, status=status.HTTP_403_FORBIDDEN)


def _conflict(reason):
    return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)


class OrganizationViewSet(viewsets.ModelViewSet):
    """Read by anybody (while active), founded by any adult, run by its own owners and admins.

    Addressed by **numeric pk**, following the project's id convention — the slug is what
    `/organizations/[slug]` on the frontend resolves, through `?slug=`, exactly as `venues` does.
    """

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _OrganizationsGate]
    serializer_class = OrganizationSerializer

    def get_queryset(self):
        qs = visible_organizations(self.request.user).select_related('created_by__profile')
        if self.action == 'list':
            qs = qs.annotate(
                member_count_annotated=Count('members', distinct=True),
                link_count_annotated=Count('links', distinct=True),
            )
            params = self.request.query_params
            slug = params.get('slug')
            if slug:
                qs = qs.filter(slug=slug)
            kind = params.get('kind')
            if kind:
                qs = qs.filter(kind=kind)
            q = (params.get('q') or '').strip()
            if q:
                qs = qs.filter(Q(name__icontains=q) | Q(city__icontains=q))
            if params.get('mine') == '1':
                # Not "managed by" — the account menu's "My organisations" means every body this
                # person is listed in, including the ones they are merely a member of.
                if not self.request.user.is_authenticated:
                    return qs.none()
                qs = qs.filter(members__user=self.request.user).distinct()
        return qs

    def get_serializer_class(self):
        return OrganizationSummarySerializer if self.action == 'list' else OrganizationSerializer

    def create(self, request, *args, **kwargs):
        reason = found_block_reason(request.user)
        if reason:
            return _forbidden(reason)
        write = OrganizationWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        organization = services.found(creator=request.user, **write.validated_data)
        return Response(
            OrganizationSerializer(organization, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        organization = self.get_object()
        if not can_manage(request.user, organization):
            return _forbidden('not_org_manager')
        write = OrganizationWriteSerializer(
            organization, data=request.data, partial=kwargs.pop('partial', False)
        )
        write.is_valid(raise_exception=True)
        write.save()
        return Response(
            OrganizationSerializer(organization, context=self.get_serializer_context()).data
        )

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        # Deactivated, never deleted (house rule 12): every link that names this body still has to
        # resolve, and the people who were in it keep their page. Owners only — an administrator
        # keeps the page tidy, an owner decides the body is over.
        organization = self.get_object()
        from .access import role_of

        if role_of(request.user, organization) != 'owner':
            return _forbidden('not_org_owner')
        organization.is_active = False
        organization.save(update_fields=['is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get', 'post'], url_path='members')
    def members(self, request, pk=None):
        """The roster. Readable by anyone who can see the organisation — a body's membership is
        what it is *for*, and hiding it would make the page a name and nothing else. Written by its
        managers, by **account id** (there is no people search; the form says so)."""
        organization = self.get_object()
        if request.method == 'GET':
            rows = organization.members.select_related('user__profile', 'added_by__profile')
            return Response(OrganizationMemberSerializer(rows, many=True).data)
        if not can_manage(request.user, organization):
            return _forbidden('not_org_manager')
        write = OrganizationMemberWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        user = User.objects.filter(pk=write.validated_data['user_id']).first()
        if user is None:
            return Response({'detail': 'no_such_user'}, status=status.HTTP_400_BAD_REQUEST)
        if OrganizationMember.objects.filter(organization=organization, user=user).exists():
            return _conflict('already_member')
        row = OrganizationMember.objects.create(
            organization=organization,
            user=user,
            role=write.validated_data['role'],
            added_by=request.user,
        )
        return Response(OrganizationMemberSerializer(row).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'], url_path='links')
    def links(self, request, pk=None):
        """What this body runs or supports. Public to read; a link is made by somebody who runs
        BOTH ends (`access.link_block_reason`)."""
        organization = self.get_object()
        if request.method == 'GET':
            rows = organization.links.select_related('content_type', 'added_by__profile')
            return Response(
                OrganizationLinkSerializer(
                    _readable_links(rows, request.user), many=True, context={'request': request}
                ).data
            )
        write = OrganizationLinkWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        from config import nodes

        node = nodes.resolve_node(write.validated_data['node_kind'], write.validated_data['node_id'])
        if node is None or not nodes.can_view_node(request.user, node):
            # House rule 4: a node this caller cannot see does not exist for them, and neither does
            # the question of linking to it.
            raise Http404
        reason = link_block_reason(request.user, organization, node)
        if reason == 'already_linked':
            return _conflict(reason)
        if reason == 'not_linkable':
            return Response({'detail': reason}, status=status.HTTP_400_BAD_REQUEST)
        if reason:
            return _forbidden(reason)
        row = OrganizationLink.objects.create(
            organization=organization,
            content_type=nodes.node_content_type(node),
            object_id=node.pk,
            kind=write.validated_data['kind'],
            added_by=request.user,
        )
        return Response(
            OrganizationLinkSerializer(row, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


def _readable_links(rows, user):
    """Drop the links whose target this reader may not see, and the ones whose target is gone.

    A link is a claim about two things, so it is only public as far as the *less* public of them —
    an organisation that runs a draft event must not advertise the draft event's title on its own
    public page. This is the filter half; `link_block_reason` is the authority half (house rule 4).
    """
    from config import nodes

    keep = []
    for row in rows:
        target = row.target
        if target is None:
            continue
        if not nodes.can_view_node(user, target):
            continue
        keep.append(row)
    return keep


class OrganizationMemberViewSet(
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """`PATCH|DELETE /api/organization-members/{id}/` — change a role, or take somebody off.

    The queryset is every row on an organisation this reader can *see*, and authority is asked for
    explicitly below, because a filter that scoped this to "rows I may edit" would answer 404 to an
    ordinary member trying to edit somebody — which is the right code for a stranger and a confusing
    one for a person who is looking straight at the roster.
    """

    permission_classes = [permissions.IsAuthenticated, _OrganizationsGate]
    serializer_class = OrganizationMemberSerializer

    def get_queryset(self):
        return OrganizationMember.objects.filter(
            organization__in=visible_organizations(self.request.user)
        ).select_related('organization', 'user__profile', 'added_by__profile')

    def update(self, request, *args, **kwargs):
        row = self.get_object()
        if not can_manage(request.user, row.organization):
            return _forbidden('not_org_manager')
        write = OrganizationMemberRoleSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        wanted = write.validated_data['role']
        if row.role == 'owner' and not _may_touch_owner(request.user, row.organization):
            # An administrator runs the roster; only an owner rearranges the owners.
            return _forbidden('not_org_owner')
        reason = remove_block_reason(row.organization, row, wanted_role=wanted)
        if reason:
            return _conflict(reason)
        row.role = wanted
        row.save(update_fields=['role'])
        return Response(OrganizationMemberSerializer(row).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        row = self.get_object()
        # Leaving is not being removed: anybody may take themselves off a roster, and the
        # last-owner rule still applies to them, because "I left and now nobody runs it" is the
        # state the invariant exists to prevent however it is reached.
        is_self = row.user_id == request.user.pk
        if not is_self and not can_manage(request.user, row.organization):
            return _forbidden('not_org_manager')
        if not is_self and row.role == 'owner' and not _may_touch_owner(request.user, row.organization):
            return _forbidden('not_org_owner')
        reason = remove_block_reason(row.organization, row)
        if reason:
            return _conflict(reason)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _may_touch_owner(user, organization) -> bool:
    from .access import role_of

    return role_of(user, organization) == 'owner'


class OrganizationLinkViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """`DELETE /api/organization-links/{id}/` — take the badge off.

    **Either end may undo it.** A link is a claim about two parties, so a manager of the
    organisation or a manager of the node can remove it; the symmetry with `link_block_reason`
    (which needs *both*) is deliberate — agreeing takes two, withdrawing takes one.
    """

    permission_classes = [permissions.IsAuthenticated, _OrganizationsGate]
    serializer_class = OrganizationLinkSerializer

    def get_queryset(self):
        return OrganizationLink.objects.filter(
            organization__in=visible_organizations(self.request.user)
        ).select_related('organization', 'content_type')

    def destroy(self, request, *args, **kwargs):
        from config import nodes

        row = self.get_object()
        target = row.target
        if not (
            can_manage(request.user, row.organization)
            or (target is not None and nodes.can_manage_node(request.user, target))
        ):
            return _forbidden('not_org_manager')
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NodeOrganizationsView(APIView):
    """`GET /api/nodes/{kind}/{id}/organizations/` — the bodies standing behind one thing.

    The panel on a course, an event or a material page reads exactly this. Routed from **this** app
    under the shared `nodes/` prefix (MANAGEMENT-BRIEF.md §2), so that `config/urls.py` and the four
    other node-hung apps are untouched by it.
    """

    permission_classes = [permissions.AllowAny, _OrganizationsGate]

    def get(self, request, kind, pk):
        from config import nodes

        node = nodes.resolve_node(kind, pk)
        if node is None or not nodes.can_view_node(request.user, node):
            raise Http404
        rows = OrganizationLink.objects.filter(
            content_type=nodes.node_content_type(node), object_id=node.pk
        ).select_related('organization', 'content_type', 'added_by__profile')
        # An inactive body's badge comes off the public page with it — `visible_organizations` is
        # the same filter the directory uses, asked here so the two can never disagree.
        rows = rows.filter(organization__in=visible_organizations(request.user))
        data = OrganizationLinkSerializer(rows, many=True, context={'request': request}).data
        return Response(data)


class MyOrganizationsView(APIView):
    """`GET /api/organizations/managed/` — the bodies this account runs, for the "link this" picker.

    Its own endpoint rather than another `?mine=` value because it answers a different question:
    `?mine=1` is "where am I listed", this is "where may I act", and a picker fed by the first would
    offer options the API then refuses (house rule 6 from the other side — do not offer a refusal).
    """

    permission_classes = [permissions.IsAuthenticated, _OrganizationsGate]

    def get(self, request):
        rows = (
            visible_organizations(request.user)
            .filter(pk__in=organizations_managed_by(request.user))
            .annotate(
                member_count_annotated=Count('members', distinct=True),
                link_count_annotated=Count('links', distinct=True),
            )
        )
        return Response(
            OrganizationSummarySerializer(rows, many=True, context={'request': request}).data
        )
