from django.contrib import admin

from .models import ActivityEvent, Post


@admin.register(ActivityEvent)
class ActivityEventAdmin(admin.ModelAdmin):
    list_display = ['kind', 'target_label', 'actor', 'created_at']
    list_filter = ['kind']
    raw_id_fields = [
        'actor', 'exercise', 'material', 'course', 'happening', 'service', 'post',
        'branch', 'discipline',
    ]


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'author', 'discipline', 'branch', 'tag', 'is_removed', 'created_at']
    list_filter = ['is_removed']
    raw_id_fields = ['author', 'ref_exercise', 'ref_material', 'ref_course']
