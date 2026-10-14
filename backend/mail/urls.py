from django.urls import path

from . import views

urlpatterns = [
    path('auth/confirm-email/', views.ConfirmEmailView.as_view(), name='auth-confirm-email'),
    path('auth/confirm-email/resend/', views.ResendConfirmationView.as_view(), name='auth-confirm-email-resend'),
    path('auth/me/mail/', views.MyMailView.as_view(), name='auth-me-mail'),
    path('auth/password-reset/confirm/', views.PasswordResetConfirmView.as_view(), name='auth-password-reset-confirm'),
    path('mail/status/', views.MailStatusView.as_view(), name='mail-status'),
    path('mail/outbound/', views.OutboundListView.as_view(), name='mail-outbound'),
    path('mail/outbound/<int:pk>/', views.OutboundDetailView.as_view(), name='mail-outbound-detail'),
    path('mail/outbound/<int:pk>/retry/', views.OutboundRetryView.as_view(), name='mail-outbound-retry'),
    path('mail/test/', views.SendTestView.as_view(), name='mail-test'),
    path('mail/inbound/', views.InboundListView.as_view(), name='mail-inbound'),
    path('mail/inbound/fetch/', views.InboundFetchView.as_view(), name='mail-inbound-fetch'),
    path('mail/inbound/<int:pk>/', views.InboundDetailView.as_view(), name='mail-inbound-detail'),
]
