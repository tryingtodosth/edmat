"""Section 14's /api/auth/... surface, backed by DRF TokenAuthentication (Section 18 item 1,
resolved for this prototype — see config/settings.py's own note)."""

from django.contrib.auth import authenticate, get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .avatar import process_avatar
from .models import DonationLink, Profile
from .serializers import (
    DonationLinkSerializer,
    ProfileSerializer,
    ProfileUpdateSerializer,
    PublicProfileSerializer,
    RegisterSerializer,
)
from .throttles import LoginRateThrottle, LoginUsernameRateThrottle

User = get_user_model()


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'register'

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _created = Token.objects.get_or_create(user=user)
        return Response(
            {
                'token': token.key,
                'profile': ProfileSerializer(user.profile, context={'request': request}).data,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    """Accepts either a real username or an email in the `username` field — the frontend's own
    login form only ever asks for an email (matching Phase 1's UX unchanged), so this resolves an
    email to its real username before handing off to Django's own username-based `authenticate()`,
    rather than requiring the login UI to know or ask for a separate technical username at all."""

    permission_classes = [permissions.AllowAny]
    # Two throttles, not one — they stop genuinely different attacks (per-IP hammering vs. per-account
    # credential stuffing from a distributed pool), and neither subsumes the other. Set explicitly
    # here rather than via `throttle_scope`, since `ScopedRateThrottle` supports only one scope per
    # view; see accounts/throttles.py for the full reasoning and its own stated limitation.
    throttle_classes = [LoginRateThrottle, LoginUsernameRateThrottle]

    def post(self, request):
        identifier = request.data.get('username', '')
        password = request.data.get('password')
        username = identifier
        if '@' in identifier:
            match = User.objects.filter(email__iexact=identifier).first()
            if match:
                username = match.username
        user = authenticate(request, username=username, password=password)
        if user is None:
            return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)
        token, _created = Token.objects.get_or_create(user=user)
        return Response(
            {'token': token.key, 'profile': ProfileSerializer(user.profile, context={'request': request}).data}
        )


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        request.user.auth_token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(ProfileSerializer(request.user.profile, context={'request': request}).data)

    def patch(self, request):
        """Self-service profile editing — display name, preferred locale, and the privacy/
        notification-preference toggles (accounts/models.py's Profile fields, see
        ProfileUpdateSerializer's own doc comment for exactly what is and isn't self-editable).
        Returns the FULL profile shape afterward (ProfileSerializer, same as GET), not just the
        narrower update serializer's own fields, so the frontend can replace its whole local `user`
        object from one response rather than merging two differently-shaped ones."""
        serializer = ProfileUpdateSerializer(request.user.profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(ProfileSerializer(request.user.profile, context={'request': request}).data)


class AvatarView(APIView):
    """POST/DELETE /api/auth/me/avatar/ — the profile-picture upload CLAUDE.md Section 17B has listed
    as "no avatar upload UI anywhere" since the Notifications feature, and the reason
    `Profile.avatar`'s complete lack of file validation was, until now, unreachable rather than
    exploitable.

    Deliberately its own endpoint rather than a writable `avatar` field on `ProfileUpdateSerializer`
    (where the field is still, correctly, absent). Three reasons, all real: the request is multipart
    rather than JSON, so folding it into `MeView.patch` would mean that one endpoint serving two
    different content types; the upload needs its own much tighter throttle scope than ordinary
    profile edits, which `ScopedRateThrottle` can only express per-view; and removing an avatar is a
    genuine DELETE of a stored file, not a field set to null, so it deserves the verb that says so.

    **The uploaded bytes are never stored.** `process_avatar` decodes and re-encodes every accepted
    image into a fresh 512x512 WebP — see accounts/avatar.py for why that is a stronger guarantee
    than content sniffing, and why EXIF stripping here is a privacy fix, not just a security one."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = 'avatar'

    def post(self, request):
        upload = request.FILES.get('avatar')
        if upload is None:
            return Response(
                {'avatar': ['No file was submitted.']}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            processed = process_avatar(upload)
        except DjangoValidationError as exc:
            # `process_avatar` raises Django's ValidationError (it is also wired in as a real model
            # field validator), which DRF does NOT translate into a 400 on its own — an uncaught one
            # surfaces as a 500. Translated explicitly here into the same `{field: [messages]}` shape
            # every other error in this API uses, so `lib/api/client.ts`'s own ApiError parsing can
            # branch on it exactly as it already does elsewhere.
            return Response({'avatar': list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)

        profile = request.user.profile
        # Delete the previous derivative before saving the new one. Without this, every re-upload
        # would leave its predecessor orphaned in MEDIA_ROOT forever — Django's FileField does not
        # clean up a replaced file, and the random UUID names mean nothing would ever overwrite them.
        # `save=False` because the model save happens once, below, with the new file attached.
        profile.avatar.delete(save=False)
        profile.avatar.save(processed.name, processed, save=True)
        return Response(ProfileSerializer(profile, context={'request': request}).data)

    def delete(self, request):
        profile = request.user.profile
        if profile.avatar:
            profile.avatar.delete(save=False)
            profile.avatar = None
            profile.save(update_fields=['avatar'])
        return Response(ProfileSerializer(profile, context={'request': request}).data)


class UserPublicView(generics.RetrieveAPIView):
    """GET /api/users/{id}/ — resolves a review/comment/translation author's display name for
    anyone (public, matching this app's already-public reviews/comments/translations lists);
    `pk` is the USER's own id, the same id every author reference elsewhere in this API already
    uses (Review.author, Comment.author, ExerciseTranslation.translated_by, ...)."""

    queryset = Profile.objects.select_related('user')
    serializer_class = PublicProfileSerializer
    permission_classes = [permissions.AllowAny]

    def get_object(self):
        return get_object_or_404(self.get_queryset(), user_id=self.kwargs['pk'])


class UserReviewsView(generics.ListAPIView):
    """GET /api/users/{id}/reviews/ — every EXERCISE review this user has authored, publicly
    visible ones only (excludes a moderator-removed or still-auto-hidden row, the exact same
    `is_removed=False, auto_hidden_at__isnull=True` visibility filter `ExerciseViewSet.reviews`
    already applies for a single exercise's own review list — this is the same data, just sliced by
    author instead of by exercise). Public, `AllowAny` — a review is already public content
    everywhere else it appears (an exercise's own detail page), so listing the same rows grouped by
    their author isn't a new disclosure. Feeds the public profile page's own "their reviews"
    section (CLAUDE.md's tutoring-listings feature note, item 6 — "user profiles should list...
    their reviews")."""

    permission_classes = [permissions.AllowAny]
    pagination_class = None

    def get_serializer_class(self):
        from community.serializers import ReviewSerializer

        return ReviewSerializer

    def get_queryset(self):
        from community.models import Review

        return Review.objects.filter(
            author_id=self.kwargs['pk'], is_removed=False, auto_hidden_at__isnull=True
        ).order_by('-created_at')


class UserServiceReviewsView(generics.ListAPIView):
    """GET /api/users/{id}/service-reviews/ — the same idea as `UserReviewsView` above, for
    tutoring-listing reviews instead of exercise reviews (`ServiceReview` has no `is_removed`/
    `auto_hidden_at` fields at all — Section 17P's own "Left open" note already flags that neither
    Service reviews nor listings are wired into the report/auto-hide system yet, so there is
    nothing here to filter by beyond the plain rows themselves)."""

    permission_classes = [permissions.AllowAny]
    pagination_class = None

    def get_serializer_class(self):
        from services.serializers import ServiceReviewSerializer

        return ServiceReviewSerializer

    def get_queryset(self):
        from services.models import ServiceReview

        return ServiceReview.objects.filter(author_id=self.kwargs['pk']).order_by('-created_at')


class DonationLinkViewSet(viewsets.ModelViewSet):
    """Self-service CRUD for the CURRENT user's own donation links — "users can set multiple
    donation links that [a visitor] can choose from" (accounts/models.py's DonationLink). Always
    scoped to `request.user.profile` via `get_queryset`/`perform_create`, never a `profile` id
    accepted from the client — there's no route here that lets one account edit another's links.
    Reading someone ELSE's donation links happens through `GET /api/users/{id}/`'s own embedded
    `donation_links` (PublicProfileSerializer), not through this ViewSet.
    """

    serializer_class = DonationLinkSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return DonationLink.objects.filter(profile=self.request.user.profile)

    def perform_create(self, serializer):
        serializer.save(profile=self.request.user.profile)


class PasswordResetView(APIView):
    """⚠️ Mock-era stub, not a real reset flow — matches this project's own established honesty
    convention for anything that needs a real email backend it doesn't have yet (see CLAUDE.md's own
    "flag it, don't fake it" instinct, e.g. its Section 18 open questions). Always returns 200
    regardless of whether the email is registered, deliberately — same account-enumeration-avoidance
    reasoning already applied elsewhere in this project's own sibling repos."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        return Response({'detail': 'If that email is registered, a reset link would be sent.'})
