"""Linked identities are an operator surface (who signs in how); the three short-lived tables are
read-only evidence while they exist and are emptied by `manage.py sso_purge`, never by a button
(backend/CLAUDE.md, "The Django admin", rules 2 and 3)."""

from django.contrib import admin

from .models import SsoAttempt, SsoIdentity, SsoLinkTicket, SsoLoginCode, SsoSignupTicket


@admin.register(SsoIdentity)
class SsoIdentityAdmin(admin.ModelAdmin):
    list_display = ('provider', 'user', 'email', 'email_verified', 'linked_at', 'last_login_at')
    list_filter = ('provider', 'email_verified')
    search_fields = ('email', 'user__username', 'subject')
    raw_id_fields = ('user',)
    readonly_fields = ('provider', 'subject', 'email', 'email_verified', 'linked_at', 'last_login_at')

    def has_add_permission(self, request):
        return False


class _ReadOnly(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(SsoAttempt)
class SsoAttemptAdmin(_ReadOnly):
    list_display = ('provider', 'intent', 'status', 'created_at', 'expires_at')
    list_filter = ('provider', 'intent', 'status')
    exclude = ('code_verifier', 'nonce', 'browser_key_hash', 'state')
    raw_id_fields = ('user',)


@admin.register(SsoLoginCode)
class SsoLoginCodeAdmin(_ReadOnly):
    list_display = ('provider', 'kind', 'user', 'status', 'created_at', 'expires_at')
    list_filter = ('provider', 'kind', 'status')
    exclude = ('code_hash', 'browser_key_hash')
    raw_id_fields = ('user',)


@admin.register(SsoSignupTicket)
class SsoSignupTicketAdmin(_ReadOnly):
    list_display = ('provider', 'email', 'email_verified', 'status', 'created_at', 'expires_at')
    list_filter = ('provider', 'status')
    exclude = ('ticket_hash', 'browser_key_hash')


@admin.register(SsoLinkTicket)
class SsoLinkTicketAdmin(_ReadOnly):
    list_display = ('provider', 'user', 'status', 'password_failures', 'created_at', 'expires_at')
    list_filter = ('provider', 'status')
    exclude = ('ticket_hash', 'browser_key_hash', 'mail_nonce')
    raw_id_fields = ('user',)
