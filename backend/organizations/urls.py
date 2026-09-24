"""`/api/organizations/`, `/api/organization-members/`, `/api/organization-links/`, plus the two
paths that hang off something else: this body's own "what may I link" list, and the organisations
behind one node.

`nodes/<kind>/<pk>/organizations/` is routed from **this** app rather than from `config/urls.py`,
which is what MANAGEMENT-BRIEF.md §2 asks of every step: the shared prefix is shared, the nested
path under it belongs to whichever app answers it, and `config/urls.py` is therefore untouched by
all six branches.

`managed/` is declared BEFORE the router's own patterns for the reason `shifts/urls.py` records
about ordering: the router's detail pattern is `organizations/(?P<pk>[0-9]+)/`, which cannot match
the word `managed`, so the order is not strictly load-bearing here — but stating the literal path
first is what keeps it that way if the lookup regex is ever widened.
"""

from django.urls import path

from config.routers import NumericPkRouter

from .views import (
    MyOrganizationsView,
    NodeOrganizationsView,
    OrganizationLinkViewSet,
    OrganizationMemberViewSet,
    OrganizationViewSet,
)

router = NumericPkRouter()
router.register('organizations', OrganizationViewSet, basename='organization')
router.register('organization-members', OrganizationMemberViewSet, basename='organization-member')
router.register('organization-links', OrganizationLinkViewSet, basename='organization-link')

urlpatterns = [
    path('organizations/managed/', MyOrganizationsView.as_view(), name='organizations-managed'),
    path(
        'nodes/<str:kind>/<int:pk>/organizations/',
        NodeOrganizationsView.as_view(),
        name='node-organizations',
    ),
] + router.urls
