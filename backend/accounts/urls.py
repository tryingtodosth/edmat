from django.urls import path
from rest_framework.routers import DefaultRouter

from .profile_extras import (
    ExperienceViewSet,
    SkillViewSet,
    UserActivityView,
    UserProfileExtrasView,
)
from .views import (
    AvatarView,
    DonationLinkViewSet,
    LoginView,
    LogoutView,
    MeView,
    PasswordResetView,
    RegisterView,
    UserPublicView,
    UserReviewsView,
    UserServiceReviewsView,
)

router = DefaultRouter()
router.register('donation-links', DonationLinkViewSet, basename='donation-link')
router.register('me/experience', ExperienceViewSet, basename='my-experience')
router.register('me/skills', SkillViewSet, basename='my-skill')

urlpatterns = router.urls + [
    path('auth/register/', RegisterView.as_view(), name='auth-register'),
    path('auth/login/', LoginView.as_view(), name='auth-login'),
    path('auth/logout/', LogoutView.as_view(), name='auth-logout'),
    path('auth/me/', MeView.as_view(), name='auth-me'),
    path('auth/me/avatar/', AvatarView.as_view(), name='auth-me-avatar'),
    path('auth/password-reset/', PasswordResetView.as_view(), name='auth-password-reset'),
    path('users/<int:pk>/', UserPublicView.as_view(), name='user-public'),
    path('users/<int:pk>/extras/', UserProfileExtrasView.as_view(), name='user-extras'),
    path('users/<int:pk>/activity/', UserActivityView.as_view(), name='user-activity'),
    path('users/<int:pk>/reviews/', UserReviewsView.as_view(), name='user-reviews'),
    path(
        'users/<int:pk>/service-reviews/',
        UserServiceReviewsView.as_view(),
        name='user-service-reviews',
    ),
]
