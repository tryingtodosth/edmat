"""The admin for the "AI-assisted" mark: the author's own disclosure, the readers' votes and a
moderator's lock.

There is no `score` field to show, and that is the point — the score is **recounted** from these
three tables (house rule 5), so the honest admin surface is the inputs. A `ScoreLock` is the one row
that overrides the recount, which is why it carries a `reason` and is listed with it.
"""

from django.contrib import admin

from .models import AssistanceVote, AuthorMark, ScoreLock


@admin.register(AuthorMark)
class AuthorMarkAdmin(admin.ModelAdmin):
    list_display = ('content_type', 'object_id', 'assisted', 'version_label', 'declared_by', 'updated_at')
    list_filter = ('assisted', 'content_type')
    search_fields = ('note', 'version_label', 'declared_by__username')
    raw_id_fields = ('declared_by',)


@admin.register(AssistanceVote)
class AssistanceVoteAdmin(admin.ModelAdmin):
    list_display = ('content_type', 'object_id', 'voter', 'confidence', 'updated_at')
    list_filter = ('confidence', 'content_type')
    search_fields = ('voter__username',)
    raw_id_fields = ('voter',)


@admin.register(ScoreLock)
class ScoreLockAdmin(admin.ModelAdmin):
    list_display = ('content_type', 'object_id', 'value', 'locked_by', 'created_at')
    list_filter = ('content_type',)
    search_fields = ('reason', 'locked_by__username')
    raw_id_fields = ('locked_by',)
