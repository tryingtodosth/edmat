"""Cross-app permission gates other apps' views import directly (services/views.py's
ServiceViewSet, messaging/views.py's MessageViewSet) — kept as its own small module, separate from
views.py, so pulling in one permission class doesn't also pull in every moderation view/serializer
just to gate one unrelated app's endpoint."""

from rest_framework import permissions

from .services import is_feature_enabled


def feature_gate(key: str):
    """Returns a DRF permission class for the given FeatureFlag key. Real global staff (`is_staff`)
    always pass, unchanged, regardless of the flag — a kill switch hides a feature from ordinary
    visitors, it never locks a moderator out of their own tools (including investigating/managing a
    "killed" feature's existing data). Everyone else is blocked outright while the flag is off —
    every action (list/retrieve/create/update/delete), not just writes, matching the "hides all
    stuff related to that" intent this is built for: a killed feature should genuinely vanish from
    the API for a non-staff caller, not just from the UI that happens to hide its own nav link.

    A factory, not one shared class, because each call site needs a DIFFERENT key baked in — DRF's
    `permission_classes` list holds classes it instantiates itself, so this returns a real, distinct
    class per key rather than a single parameterized instance."""

    class _FeatureGate(permissions.BasePermission):
        message = 'This feature is currently disabled by a moderator.'

        def has_permission(self, request, view):
            user = request.user
            if user and user.is_authenticated and user.is_staff:
                return True
            return is_feature_enabled(key)

    _FeatureGate.__name__ = f'FeatureGate_{key}'
    return _FeatureGate
