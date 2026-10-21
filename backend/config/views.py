"""The one view that belongs to no app: the first-visit interface-language hint.

`GET /api/locale-hint/` answers "what language should somebody who has never chosen one see?".

It lives here rather than in an app because it is about the platform rather than about any of the
things the platform holds, and because its whole implementation is two cross-cutting modules that
already exist: `telemetry.middleware.client_ip` (the one correct way to read a caller's address
from behind the Apache reverse proxy — reused rather than re-derived, because the wrong reading of
`X-Forwarded-For` is forgeable and that mistake has already been made and measured here once) and
`config.geo.country_for_ip` (which answers `None` unless a MaxMind database is installed).
"""

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from telemetry.middleware import client_ip

from .creation import CREATION_KINDS, creation_status

from .geo import country_for_ip

# The interface catalogue is `en` + `pl` (root CLAUDE.md, "i18n — two separate axes"). A third
# interface language would add a row to this decision, not a new mechanism.
DEFAULT_LOCALE = 'pl'
ELSEWHERE_LOCALE = 'en'


def suggested_locale(country: str | None) -> str:
    """Polish unless we positively know the visitor is somewhere else.

    The asymmetry is the point and is the owner's rule, not an inference: this is a Polish
    platform with a Polish corpus, so an unknown visitor is far more likely to be Polish than not.
    `None` (no database, a private address, an address with no row) therefore resolves to Polish
    exactly like `PL` does, and only a country we can actually name and that is not Poland moves
    the answer to English.
    """
    if country is None or country == 'PL':
        return DEFAULT_LOCALE
    return ELSEWHERE_LOCALE


class LocaleHintView(APIView):
    """AllowAny, and the cheapest thing in the API: no database query at all.

    Not throttled beyond the global `anon` backstop — the frontend asks this at most once per
    browser (it remembers the answer locally, see `lib/state/locale.svelte.ts`), and a visitor who
    somehow asked it in a loop would be costing a memory-mapped lookup.

    **Never cached.** `cachemw.PUBLIC_PREFIXES` is a positive list and `/api/locale-hint/` is
    deliberately not on it: the answer is per-CALLER, so a shared cache would hand one visitor's
    country-derived language to the next anonymous visitor from anywhere. `no-store` says the same
    thing to every cache between here and the browser, for the same reason.

    `country` is in the body so that a developer (and the visitor, whose own data it is) can see
    WHY the answer is what it is — "pl because we cannot tell" and "pl because you are in Poland"
    are the same answer for very different reasons, and the difference is exactly what somebody
    debugging a wrong language needs. It is answered, not recorded: nothing in this request path
    writes the country anywhere.
    """

    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []

    def get(self, request):
        country = country_for_ip(client_ip(request))
        response = Response({'suggested_locale': suggested_locale(country), 'country': country})
        response['Cache-Control'] = 'no-store'
        return response


# ---- the management node seam (MANAGEMENT-BRIEF.md §2) ------------------------------------------
#
# Two views that belong to no single management app, because all six ask them: "what is this node
# and where do I stand on it" and "who is on its roster". Both dispatch to `config.nodes`, which is
# the one place those answers live; neither holds a rule of its own.


def _display_name(user) -> str:
    profile = getattr(user, 'profile', None)
    name = getattr(profile, 'display_name', '') if profile is not None else ''
    return name or user.get_username()


class NodeRefView(APIView):
    """`GET /api/nodes/{kind}/{id}/` → `config.nodes.node_ref`.

    404 for an unknown kind, a missing id, or a node this reader may not see (house rule 4: for
    them it does not exist, and nothing hung on it does either). Anonymous readers get the ref
    with every standing false, so a public course's panels can draw their read-only halves.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request, kind, pk):
        from django.http import Http404

        from . import nodes

        node = nodes.resolve_node(kind, pk)
        if node is None or not nodes.can_view_node(request.user, node):
            raise Http404
        return Response(nodes.node_ref(node, request.user))


class NodeStaffView(APIView):
    """`GET /api/nodes/{kind}/{id}/staff/` → `[{id, display_name}]`, the roster for a picker.

    Staff-only: a roster is not public information on any of these nodes (an event's attendee
    never sees the staff list either), so anyone below staff gets the same 404 a stranger would.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, kind, pk):
        from django.http import Http404

        from . import nodes

        node = nodes.resolve_node(kind, pk)
        if node is None or not nodes.can_view_node(request.user, node):
            raise Http404
        if not nodes.is_node_staff(request.user, node):
            raise Http404
        users = nodes.node_staff_users(node).select_related('profile').order_by('pk')
        return Response([{'id': u.pk, 'display_name': _display_name(u)} for u in users])


class CreationStatusView(APIView):
    """`GET /api/creation/` → `{kind: reason-or-null}` for every kind in `config.creation.CREATION_KINDS`.

    The Add… menu's side of the creation gate (prompts/07-creation-gate.md): the Header asks once,
    for the signed-in account, which of the four "found something" entries it may draw, so that a
    refused account never sees a button it would be refused at (house rule 3). Anonymous callers
    get every kind refused with `anonymous`; the real refusal words come from the rule module,
    never from here. The prep commit ships the rule as a stub, so until step F lands this answers
    `null` for every kind of a signed-in account.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({kind: 'anonymous' for kind in CREATION_KINDS})
        return Response(creation_status(request.user))


class PeopleSuggestionsView(APIView):
    """`GET /api/people/suggestions/` — the people this account already shares a roster with
    (`contests/people.py: suggested_people`), for every "add a person" form on the site (owner,
    2026-10-21: "give user a list instead" of an account-id box).

    Routed here, with no feature gate, rather than at the contest wizard's own
    `/api/contests/people-suggestions/` (which stays, behind `contests`): a course's staff panel
    must keep its picker when contests are switched off, and "who do you already work with" is a
    reading of memberships the caller already holds, not a feature surface of its own. There is
    still no people search, by design — this never names anybody the caller does not already
    share a course, an event, an organisation or a material project with.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from contests.people import suggested_people

        return Response({'people': suggested_people(request.user)})

