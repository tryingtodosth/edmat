from django.urls import path

from .views import (
    CallbackView,
    CompleteSignupView,
    ExchangeView,
    IdentitiesView,
    IdentityDetailView,
    LinkEmailConfirmView,
    LinkEmailView,
    LinkPasswordView,
    LinkTicketView,
    ProvidersView,
    StartView,
    TicketView,
)

urlpatterns = [
    path('auth/sso/providers/', ProvidersView.as_view(), name='sso-providers'),
    path('auth/sso/exchange/', ExchangeView.as_view(), name='sso-exchange'),
    path('auth/sso/ticket/', TicketView.as_view(), name='sso-ticket'),
    path('auth/sso/complete/', CompleteSignupView.as_view(), name='sso-complete'),
    path('auth/sso/identities/', IdentitiesView.as_view(), name='sso-identities'),
    path('auth/sso/identities/<int:pk>/', IdentityDetailView.as_view(), name='sso-identity'),
    path('auth/sso/link/ticket/', LinkTicketView.as_view(), name='sso-link-ticket'),
    path('auth/sso/link/password/', LinkPasswordView.as_view(), name='sso-link-password'),
    path('auth/sso/link/email/', LinkEmailView.as_view(), name='sso-link-email'),
    path('auth/sso/link/email/confirm/', LinkEmailConfirmView.as_view(), name='sso-link-email-confirm'),
    path('auth/sso/<str:provider_id>/start/', StartView.as_view(), name='sso-start'),
    path('auth/sso/<str:provider_id>/callback/', CallbackView.as_view(), name='sso-callback'),
]
