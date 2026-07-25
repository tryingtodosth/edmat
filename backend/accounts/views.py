"""Section 14's /api/auth/... surface, backed by DRF TokenAuthentication (Section 18 item 1,
resolved for this prototype — see config/settings.py's own note)."""

from django.contrib.auth import authenticate, get_user_model
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Profile
from .serializers import ProfileSerializer, PublicProfileSerializer, RegisterSerializer

User = get_user_model()


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _created = Token.objects.get_or_create(user=user)
        return Response(
            {'token': token.key, 'profile': ProfileSerializer(user.profile).data},
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    """Accepts either a real username or an email in the `username` field — the frontend's own
    login form only ever asks for an email (matching Phase 1's UX unchanged), so this resolves an
    email to its real username before handing off to Django's own username-based `authenticate()`,
    rather than requiring the login UI to know or ask for a separate technical username at all."""

    permission_classes = [permissions.AllowAny]

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
        return Response({'token': token.key, 'profile': ProfileSerializer(user.profile).data})


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        request.user.auth_token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(ProfileSerializer(request.user.profile).data)


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


class PasswordResetView(APIView):
    """⚠️ Mock-era stub, not a real reset flow — matches this project's own established honesty
    convention for anything that needs a real email backend it doesn't have yet (see CLAUDE.md's own
    "flag it, don't fake it" instinct, e.g. its Section 18 open questions). Always returns 200
    regardless of whether the email is registered, deliberately — same account-enumeration-avoidance
    reasoning already applied elsewhere in this project's own sibling repos."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        return Response({'detail': 'If that email is registered, a reset link would be sent.'})
