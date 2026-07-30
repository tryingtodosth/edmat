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


class RequireVerifiedContributorForMaterialUploads(permissions.BasePermission):
    """A second, DIFFERENTLY-SHAPED kind of gate from `feature_gate` above — not a blanket kill
    switch (that's `material_submissions`, unchanged), but a narrower restriction: when the
    `material_uploads_verified_only` FeatureFlag is turned ON, only a verified contributor (or real
    staff) may submit a NEW material upload; an ordinary authenticated user is blocked from that one
    action, not from the whole feature (they can still see their own past submissions, which this
    permission is deliberately only ever applied to the `create` action for, see
    MaterialSubmissionViewSet.get_permissions).

    `is_feature_enabled` reads this row exactly like any other — `is_enabled=True` here means "the
    RESTRICTION is active," the inverse of what that name means for the other 4 flags (FeatureFlag's
    own FEATURE_FLAG_CHOICES doc comment already flags this explicitly). Fails OPEN the same way
    `is_feature_enabled` always does if the row is somehow missing (returns True — meaning
    "restricted") — the one flag in this app where that fail-open default reads as fail-CLOSED for
    an ordinary user, a deliberate reversal from `feature_gate`'s own default-permissive stance: an
    anti-abuse gate defaulting to "restricted" if its own config row was never seeded is the safer
    failure direction, not a bug — though in practice this never happens, since the row is always
    provisioned by its own data migration (0011)."""

    message = 'Only verified contributors can upload materials right now.'

    def has_permission(self, request, view):
        user = request.user
        if user and user.is_authenticated and user.is_staff:
            return True
        if not is_feature_enabled('material_uploads_verified_only'):
            return True
        profile = getattr(user, 'profile', None)
        return bool(profile and profile.is_verified_contributor)
