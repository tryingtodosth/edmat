from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import DonationLink, Profile

User = get_user_model()


class DonationLinkInline(admin.TabularInline):
    model = DonationLink
    extra = 0


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'display_name', 'preferred_locale', 'is_verified_contributor', 'joined_at']
    list_filter = ['is_verified_contributor', 'preferred_locale']
    inlines = [DonationLinkInline]


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

    A genuine erasure request (GDPR Article 17, which this project's own launch checklist still has
    open) is the one case that really does need deletion — and it needs a considered flow that
    decides per model what to anonymise versus remove, not a cascade that takes other people's
    threads with it. Until that exists, one-at-a-time deletion with the confirmation page read
    properly is the honest interim.
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
