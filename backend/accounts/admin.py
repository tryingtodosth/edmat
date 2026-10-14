from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import (
    Certificate,
    DonationLink,
    ExperienceEntry,
    Guardianship,
    Profile,
    SkillEntry,
)

User = get_user_model()


class DonationLinkInline(admin.TabularInline):
    model = DonationLink
    extra = 0


# The profile's own CV rows (2026-10-08). Inlines rather than four more entries in the sidebar:
# every one of them is meaningless away from the profile it belongs to, and an administrator looking
# at somebody's skills is already looking at that person.
class ExperienceEntryInline(admin.TabularInline):
    model = ExperienceEntry
    extra = 0
    fields = ('order', 'kind', 'title', 'organisation', 'started_on', 'ended_on')
    ordering = ('order',)


class SkillEntryInline(admin.TabularInline):
    model = SkillEntry
    extra = 0
    fields = ('order', 'label', 'level', 'evidence', 'discipline', 'branch')
    raw_id_fields = ('discipline', 'branch')
    ordering = ('order',)


class CertificateInline(admin.TabularInline):
    model = Certificate
    extra = 0
    fields = ('order', 'title', 'issuer', 'issued_on', 'expires_on', 'credential_id')
    ordering = ('order',)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    # `max_courses` and `material_upload_quota_bytes` are both editable straight from the
    # changelist: raising or lowering somebody's ceiling is a one-number decision, and making an
    # administrator open each profile in turn to do it is how a limit ends up being managed in the
    # database instead.
    #
    # `material_upload_used` sits beside the quota for the same reason `TaughtCourseAdmin` puts
    # `uploaded_mb` next to `upload_quota_bytes`: a quota with nothing to compare it against is a
    # number nobody can choose sensibly. Somebody deciding what to allow needs to see what people
    # actually store — 4MB or 400MB is the whole difference between a limit that bites and one that
    # is decoration.
    list_display = [
        'user',
        'display_name',
        'preferred_locale',
        'is_verified_contributor',
        'max_courses',
        'material_upload_quota_bytes',
        'material_upload_used',
        'joined_at',
    ]
    list_editable = ['max_courses', 'material_upload_quota_bytes']
    list_filter = ['is_verified_contributor', 'preferred_locale']
    inlines = [DonationLinkInline, ExperienceEntryInline, SkillEntryInline, CertificateInline]

    @admin.display(description='Material uploads (used / allowed)')
    def material_upload_used(self, obj):
        """Both halves in one cell, in MB, because they are only meaningful against each other.

        The quota column beside it stays in raw bytes — it is the editable one, and an administrator
        typing a limit should type the unit the field actually stores rather than one this display
        rounds; `TaughtCourseAdmin` draws the same line between `upload_quota_bytes` and
        `uploaded_mb`. "no limit" rather than a bare 0 for the uncapped case, since 0 in a column
        headed "allowed" reads as "nothing allowed", which is the opposite of what it means.

        This costs a `stat()` per submission per row (`Profile.material_upload_bytes` sums live —
        see its own comment for why that is the right call). A changelist of 100 profiles is not a
        hot path and this is the one screen where the number is the point; if it ever does get slow,
        the fix is the stored-size column that property already names, not a cached figure here that
        could disagree with the check the upload path actually enforces.
        """
        used_mb = obj.material_upload_bytes / (1024 * 1024)
        if not obj.material_upload_quota_bytes:
            return f'{used_mb:.1f}MB / no limit'
        allowed_mb = obj.material_upload_quota_bytes / (1024 * 1024)
        return f'{used_mb:.1f}MB / {allowed_mb:.1f}MB'


admin.site.unregister(User)


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    """Django's own UserAdmin, with the bulk-delete action removed and deactivation offered instead.

    **The problem this exists for is irreversible data loss, not permissions.** `Review.author`,
    `Comment.author`, `ExerciseSet.owner` and `Profile.user` are all `on_delete=CASCADE` and not
    nullable, so deleting one user hard-deletes every review, comment and study set they ever wrote.
    Those rows are other people's reading material — a review is what a student consults before
    trusting a solution, and a comment thread is where someone else's question was answered — so
    removing one account silently subtracts content from pages that have nothing to do with it. The
    neighbouring FKs (`Exercise.submitted_by`, `ExerciseTranslation.translated_by`/`reviewed_by`,
    the `reviewed_by` columns on both moderation models) are `SET_NULL` and do survive, just
    unattributed, which makes the damage genuinely uneven and hard to predict from the outside.

    Two changes, both deliberately mild — this restricts nothing an administrator cannot still do:

    1. **The bulk `delete_selected` action is removed.** Django's single-object delete confirmation
       does enumerate what is about to cascade, and that page is worth reading; the bulk action's
       confirmation summarises across every selected user at once, which is exactly where a large
       cascade stops being legible. Deleting one user at a time still works normally, warning and
       all — this only removes the path where the warning is least likely to be understood.
    2. **A `deactivate_users` action is added, and it is the right default for almost every real
       case.** "This person should not be able to log in" is what is actually wanted nearly every
       time a delete is reached for — a spammer, a departed moderator, a compromised account —
       and `is_active=False` achieves it completely: Django's own `authenticate()` refuses an
       inactive user, so the account is shut without touching a single row of anyone's content.
       It is also reversible, which a delete never is.

    A genuine erasure request (GDPR Article 17) is NOT this page's delete either: since 2026-10-14
    it is `accounts/erasure.py`, which decides per model what to delete, anonymise or keep and
    leaves a scrubbed tombstone instead of cascading through other people's threads. A person asks
    from Settings → Account; an operator acting on a written request runs
    `manage.py erase_due_accounts --now --user <id>` after creating the request. The delete button
    here remains for the rare row that genuinely has to go (a test account), read with care.
    """

    actions = ['deactivate_users']

    def get_actions(self, request):
        actions = super().get_actions(request)
        actions.pop('delete_selected', None)
        return actions

    @admin.action(description='Deactivate selected users (blocks login, keeps all their content)')
    def deactivate_users(self, request, queryset):
        updated = queryset.update(is_active=False)
        self.message_user(
            request,
            f'{updated} user(s) deactivated. They can no longer log in; every review, comment and '
            'study set they wrote is untouched. Re-activate by setting "Active" again.',
        )


@admin.register(Guardianship)
class GuardianshipAdmin(admin.ModelAdmin):
    """Who answers for a child's account, and the consent that says so.

    Listed on its own rather than only as an inline because the question an operator actually has is
    "which children have nobody on file" — a question about the TABLE, not about one profile. The
    consent fields are shown and `revoked_at` is the lifecycle: a revoked guardianship is kept
    (house rule 12), because who was responsible last March is part of the record.
    """

    list_display = ('child', 'guardian', 'consent_method', 'consent_given_at', 'revoked_at')
    list_filter = ('consent_method', 'revoked_at')
    search_fields = ('child__username', 'guardian__username')
    raw_id_fields = ('child', 'guardian')


from .models import AccountErasure  # noqa: E402


@admin.register(AccountErasure)
class AccountErasureAdmin(admin.ModelAdmin):
    """The record of every deletion request and what became of it (`accounts/erasure.py`). Evidence,
    so read-only: a status changed by hand would be a deletion that never ran, or one that did and
    says it did not (backend/CLAUDE.md, admin rule 2). Cancelling or carrying one out goes through
    the module — the account page, the guardian's panel, or `erase_due_accounts`."""

    list_display = ('user', 'status', 'by_guardian', 'requested_at', 'due_at', 'completed_at')
    list_filter = ('status', 'by_guardian')
    raw_id_fields = ('user', 'requested_by')
    readonly_fields = [f.name for f in AccountErasure._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
