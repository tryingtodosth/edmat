from django.contrib import admin

from .models import CoopSettings


@admin.register(CoopSettings)
class CoopSettingsAdmin(admin.ModelAdmin):
    list_display = ('project', 'policy', 'updated_by', 'updated_at')
    list_filter = ('policy',)
    raw_id_fields = ('project', 'updated_by')
