from django.urls import path

from .views import LoginView, LogoutView, MeView, PasswordResetView, RegisterView, UserPublicView

urlpatterns = [
    path('auth/register/', RegisterView.as_view(), name='auth-register'),
    path('auth/login/', LoginView.as_view(), name='auth-login'),
    path('auth/logout/', LogoutView.as_view(), name='auth-logout'),
    path('auth/me/', MeView.as_view(), name='auth-me'),
    path('auth/password-reset/', PasswordResetView.as_view(), name='auth-password-reset'),
    path('users/<int:pk>/', UserPublicView.as_view(), name='user-public'),
]
